<?php
/**
 * CSES Cloud - SQLite 数据库封装
 */

class DB
{
    private static $pdo = null;

    /** 获取 PDO 单例 */
    public static function pdo()
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        $dataDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
        if (!is_dir($dataDir)) {
            mkdir($dataDir, 0777, true);
        }

        $dbPath = $dataDir . DIRECTORY_SEPARATOR . 'cses.db';
        $isNew = !file_exists($dbPath);

        try {
            self::$pdo = new PDO('sqlite:' . $dbPath);
            self::$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            self::$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            // 启用外键约束
            self::$pdo->exec('PRAGMA foreign_keys = ON');
        } catch (PDOException $e) {
            http_response_code(500);
            die('数据库连接失败: ' . htmlspecialchars($e->getMessage()));
        }

        if ($isNew) {
            self::migrate();
            self::seed();
        } else {
            // 已有数据库：执行增量迁移（补充新表/新字段）
            self::ensureSchema();
        }

        return self::$pdo;
    }

    /**
     * 增量迁移：保证已有数据库具备最新结构
     * 使用 CREATE TABLE IF NOT EXISTS 与try-catch ALTER TABLE，安全可重复执行
     */
    private static function ensureSchema()
    {
        $pdo = self::pdo();
        // 补充 schema.sql 中所有表（IF NOT EXISTS 保证幂等）
        $schema = file_get_contents(dirname(__DIR__) . DIRECTORY_SEPARATOR . 'schema.sql');
        $pdo->exec($schema);

        // instances 表新增 app_id 列（关联 apps）
        self::addMissingColumn('instances', 'app_id', 'INTEGER');

        // 实例所有者、唯一ID、组、配置（计划新增字段）
        self::addMissingColumn('instances', 'owner_user_id', 'INTEGER');
        self::addMissingColumn('instances', 'owner_type', "TEXT NOT NULL DEFAULT 'sub'");
        self::addMissingColumn('instances', 'instance_uid', 'TEXT');
        self::addMissingColumn('instances', 'group_id', 'INTEGER');
        self::addMissingColumn('instances', 'config', 'TEXT');

        // 子用户权限（JSON）
        self::addMissingColumn('users', 'permissions', 'TEXT');

        // 最高管理员标记（临时管理员可将其它用户提升为最高管理员）
        self::addMissingColumn('users', 'is_super_admin', 'INTEGER NOT NULL DEFAULT 0');

        // 通知表扩展字段
        self::addMissingColumn('notifications', 'sender_id', 'INTEGER');
        self::addMissingColumn('notifications', 'sender_name', 'TEXT');
        self::addMissingColumn('notifications', 'target_type', "TEXT NOT NULL DEFAULT 'all'");
        self::addMissingColumn('notifications', 'target_id', 'TEXT');

        // apps 表：共享与派生关系
        self::addMissingColumn('apps', 'is_shared', 'INTEGER NOT NULL DEFAULT 0');
        self::addMissingColumn('apps', 'forked_from', 'INTEGER');
        self::addMissingColumn('apps', 'forked_by', 'TEXT');
        self::addMissingColumn('apps', 'is_official', 'INTEGER NOT NULL DEFAULT 0');
        self::addMissingColumn('apps', 'control_manifest', 'TEXT');

        // users 表：个人中心扩展字段
        self::addMissingColumn('users', 'department', 'TEXT');
        self::addMissingColumn('users', 'avatar', 'TEXT');
        self::addMissingColumn('users', 'preferences', 'TEXT');

        // cloud_files 表：实例文件系统扩展字段
        self::addMissingColumn('cloud_files', 'directory', "TEXT NOT NULL DEFAULT '/'");
        self::addMissingColumn('cloud_files', 'file_size', 'INTEGER NOT NULL DEFAULT 0');
        self::addMissingColumn('cloud_files', 'file_category', "TEXT NOT NULL DEFAULT 'editor'");

        // cloud_files 目录索引（在 addMissingColumn 之后创建，确保列已存在）
        try { $pdo->exec('CREATE INDEX IF NOT EXISTS idx_cloud_files_directory ON cloud_files(directory)'); } catch (\PDOException $e) {}
        try { $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_files_path ON cloud_files(instance_id, directory, name)'); } catch (\PDOException $e) {}

        // 检测列是否存在的辅助：尝试 ALTER，若已存在则忽略
    }

    /** 为表添加缺失的列（SQLite 不支持 IF NOT EXISTS，用 try-catch） */
    private static function addMissingColumn($table, $column, $type)
    {
        $pdo = self::pdo();
        try {
            $pdo->exec("ALTER TABLE {$table} ADD COLUMN {$column} {$type}");
        } catch (PDOException $e) {
            // 列已存在，忽略
        }
    }

    /** 执行查询，返回语句对象 */
    public static function query($sql, $params = [])
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    /** 查询单行 */
    public static function one($sql, $params = [])
    {
        return self::query($sql, $params)->fetch();
    }

    /** 查询多行 */
    public static function all($sql, $params = [])
    {
        return self::query($sql, $params)->fetchAll();
    }

    /** 查询单个标量值 */
    public static function scalar($sql, $params = [])
    {
        $row = self::query($sql, $params)->fetch(PDO::FETCH_NUM);
        return $row ? $row[0] : null;
    }

    /** 插入数据，返回 lastInsertId */
    public static function insert($table, $data)
    {
        $cols = array_keys($data);
        $placeholders = array_map(fn($c) => ':' . $c, $cols);
        $sql = "INSERT INTO {$table} (" . implode(',', $cols) . ") VALUES (" . implode(',', $placeholders) . ")";
        self::query($sql, $data);
        return self::pdo()->lastInsertId();
    }

    /** 更新数据 */
    public static function update($table, $data, $where, $whereParams = [])
    {
        $set = [];
        $params = [];
        foreach ($data as $col => $value) {
            $set[] = "{$col} = :set_{$col}";
            $params["set_{$col}"] = $value;
        }
        // 将 WHERE 子句中的 ? 占位符转换为命名占位符，避免 PDO 混用占位符导致静默失败
        $whereIdx = 0;
        $whereNormalized = preg_replace_callback('/\?/', function () use (&$whereIdx) {
            return ':where_' . ($whereIdx++);
        }, $where);
        $whereParamsNorm = [];
        foreach ($whereParams as $k => $v) {
            $whereParamsNorm['where_' . (is_int($k) ? $k : $k)] = $v;
        }
        $sql = "UPDATE {$table} SET " . implode(',', $set) . " WHERE {$whereNormalized}";
        return self::query($sql, array_merge($params, $whereParamsNorm))->rowCount();
    }

    /** 删除数据 */
    public static function delete($table, $where, $params = [])
    {
        return self::query("DELETE FROM {$table} WHERE {$where}", $params)->rowCount();
    }

    /** 建表与初始结构 */
    private static function migrate()
    {
        $pdo = self::pdo();
        $schema = file_get_contents(dirname(__DIR__) . DIRECTORY_SEPARATOR . 'schema.sql');
        $pdo->exec($schema);
    }

    /** 写入初始演示数据 */
    private static function seed()
    {
        $seederPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'seed.php';
        if (file_exists($seederPath)) {
            require $seederPath;
        }
    }
}
