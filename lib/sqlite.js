/** @babel */
import {ByteArrayInputStream} from "hjs-io/lib/input";
import {BufferedReader, InputStreamReader} from "hjs-io/lib/reader";
import {EventListenerAggregate} from "eventslib/lib/aggregate";
import {HTTPConnection, LOAD_END_STATE} from "libhttp/lib/http";
import {Configuration} from "conflib/lib/conf";
import {SQLiteEvent, SQLiteParserListener, SQLiteTransactionListener} from "./event";
import {CursorFactory, CursorLoader, ExecCursor, SQLiteCursorDriver} from "./cursor";
import {DatabaseUtils, Hex, TableInfo} from "./helper";
import {SQLiteQueryBuilder, SQLiteStatement} from "./query";
import {SQLiteParser} from "./parser";
import {SQLiteSession, SQLiteQueue, SQLiteTransactionQueue} from "./session";

export class SQLiteDatabaseConfiguration {

    constructor({name="",displayName="",size=0,version=1,mode=0,path="",create_model="",drop_model=""}={}) {
        this.mName = name;
        this.mDisplayName = displayName;
        this.mSize = size;
        this.mVersion = version;
        this.mMode = mode;
        this.mPath = path;
        this.mCreateModel = create_model;
        this.mDropModel = drop_model;
    }

    getCreateModel() {
        return this.mCreateModel;
    }

    getDisplayName() {
        return this.mDisplayName;
    }

    getDropModel() {
        return this.mDropModel;
    }

    getMode() {
        return this.mMode;
    }

    getName() {
        return this.mName;
    }

    getPath() {
        return this.mPath;
    }

    getSize() {
        return this.mSize;
    }

    getVersion() {
        return this.mVersion;
    }

    isInMemoryDb() {
        return this.mPath === SQLiteDatabaseConfiguration.MEMORY_DB_PATH;
    }

    toString() {
        var str = "SQLiteDatabaseConfiguration[name:" + this.mName
            + ",\n displayName:" + this.mDisplayName
            + ",\n size:" + this.mSize + ",\n version:"
            + this.mVersion + ",\n mode:" + this.mMode
            + ",\n path:" + this.mPath
            + ",\n createModel:"
            + this.mCreateModel + ",\n dropModel:"
            + this.mDropModel + "]";
        return str;
    }
}

SQLiteDatabaseConfiguration.MEMORY_DB_PATH = ":memory:";
SQLiteDatabaseConfiguration.MEMORY_DB_DISPLAY_NAME = "memory database";

const sActiveDatabases = {};

export class SQLiteDatabase {

    constructor(configuration) {
        if (!configuration) {
            throw new ReferenceError("NullPointerException configuration must not be null.");
        }
        this.mConfiguration = configuration;
        this.mListeners = new EventListenerAggregate(SQLiteListener);
        this.mSession = new SQLiteSession(this);
        this.mCursorFactory = null;
        this.mOpen = false;
    }

    abs(X=0, adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT abs(" + X + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    addColumn(tableName="", columnDef="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("ALTER TABLE " + tableName + " ADD COLUMN " + columnDef, [], adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    addListener(listener) {
        this.mListeners.add(listener);
    }

    beginTransaction(sql="", bindArgs=[], transactionListener=null) {
        if (this.isOpen()) {
            this.mLastQuery = sql;
            this.mSession.beginTransaction(sql, bindArgs, transactionListener);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    changes(adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT changes()", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    coalesce(values=[], adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT coalesce(" + values.join(",") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    close() {
        if (this.mOpen) {
            this.mDatabase = null;
            this.mOpen = false;
            Configuration.getInstance().setBDClosed();
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    compileStatement(editTable="", query="", bindArgs=[]) {
        let stmt = SQLiteStatement.getStatements(sql);
        this.mLastQuery = query;
        if (!stmt) {
            stmt = SQLiteStatement.setStatements(query, new SQLiteStatement({
                database : this, query, editTable, bindArgs
            }));
        } else {
            stmt.setBindings(bindArgs);
        }
        return stmt;
    }

    static create({name=null,displayName=null,size=0,version=0,mode=0,path=null,createModel=null,dropModel=null,factory=null}={}) {
        try {
            let configuration = Configuration.getInstance();
            name = name || configuration.getDatabaseName();
            let database_created = sActiveDatabases[database_name] !== null &&
                sActiveDatabases[name] !== undefined;
            if (!database_created) {
                displayName = displayName || configuration.getDatabaseDisplayName();
                size = size || configuration.getDatabaseSize();
                version = version || configuration.getDatabaseVersion();
                mode = mode || configuration.getDatabaseMode();
                path = path || configuration.getDatabasePath();
                createModel = createModel || configuration.getCreateModelFile();
                drop_model = dropModel || configuration.getDropModelFile();
                let configuration = new SQLiteDatabaseConfiguration({
                    name,
                    displayName,
                    size,
                    version,
                    mode,
                    path,
                    create_model,
                    drop_model
                });
                console.log(configuration.toString());
                let database = new SQLiteDatabase(configuration);
                if (factory) {
                    database.addListener(factory);
                    if (factory instanceof CursorFactory) {
                        database.setCursorFactory(factory);
                    }
                }
                return sActiveDatabases[name] = database;
            }
            return sActiveDatabases[name];
        } catch (e) {
            throw e;
        }
    }

    createSession() {
        if (this.isOpen()) {
            return new SQLiteSession(this);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    date(timestring="", modifiers=[], adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT date(" + timestring + (modifiers && modifiers.length ? "," + modifiers.join(",") : "") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    datetime(timestring="", modifiers=[], adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT datetime(" + timestring + (modifiers && modifiers.length ? "," + modifiers.join(",") : "") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    static deleteDatabase(name) {
        if (!name) {
            throw new ReferenceError("IllegalArgumentException file must not be null");
        }
        let database = sActiveDatabases[name];
        if (database) {
            database.close();
            sActiveDatabases[name] = null;
            return true;
        }
        return false;
    }

    deleteQuery({editTable="",query="",bindArgs=[],catchError=false,adapter=null}={}) {
        if (this.isOpen()) {
            let sql = "DELETE FROM " + editTable + (query && query.length !== 0 ? " WHERE " + query : "");
            let statement = this.compileStatement(editTable, sql, bindArgs);
            if (adapter) {
                adapter.setTable(editTable);
                adapter.setCatchError(catchError);
            }
            statement.executeUpdateDelete(adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    dropTable({table="",adapter=null}={}) {
        if (this.isOpen()) {
            this.execSQL("DROP TABLE IF EXISTS " + table, [], adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    endTransaction(transaction, result) {
        if (this.isOpen()) {
            this.mSession.endTransaction(transaction, result);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    enqueueTransaction(queue) {
        if (this.mOpen) {
            queue.begin();
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    execRemoteSQL({path,listener}={}) {
        new HTTPConnection({
            url: path,
            method : "GET",
            responseType: "arraybuffer",
            handler: {

                onHandleRequest: (event) => {
                    let type = event.type;
                    if (type === LOAD_END_STATE) {
                        let idx = 0;
                        let line = null;
                        let queue = this.getQueue(path);
                        let input = new Uint8Array(event.response.getMessageBody());
                        let reader = new BufferedReader({
                            input: new InputStreamReader(new ByteArrayInputStream({ input: input })),
                            size: input.length
                        });
                        while((line = reader.readLine(true))) {
                            queue.EXEC({ name: "exec-" + idx, sql: line });
                            idx++;
                        }
                        queue.execute(listener);
                    }
                }

            }
        });
    }

    execSQL(sql="", bindArgs=[], adapter=null) {
        if (this.isOpen()) {
            bindArgs = bindArgs || [];
            let type = DatabaseUtils.getSqlStatementType(sql);
            if (type === DatabaseUtils.STATEMENT_ATTACH ||
                type === DatabaseUtils.STATEMENT_BEGIN ||
                type === DatabaseUtils.STATEMENT_COMMIT ||
                type === DatabaseUtils.STATEMENT_ABORT ||
                type === DatabaseUtils.STATEMENT_PRAGMA ||
                /*type == DatabaseUtils.STATEMENT_DDL ||*/
                type === DatabaseUtils.STATEMENT_UNPREPARED) {
                let error = new SyntaxError(sql + " statement not supported.");
                if (adapter && adapter.canCatchError()) {
                    console.log(type);
                    adapter.rollback(this.createSession(), error);
                } else {
                    this.notifyListeners(new SQLiteEvent({
                        source: this,
                        id: SQLiteEvent.ERROR,
                        data: error
                    }));
                }
            } else {
                this.beginTransaction(sql, bindArgs, new SQLiteTransactionListener({
                    onBegin: (session) => {
                        if (adapter) {
                            adapter.begin(session);
                        }
                    },
                    onCommit: (session, resultSet) => {
                        if (adapter) {
                            adapter.commit(session, new ExecCursor({
                                database: this,
                                tableInfo: TableInfo.getTable(adapter.getTable()),
                                resultSet
                            }));
                        } else {
                            this.notifyListeners(new SQLiteEvent({
                                source: this,
                                id: SQLiteEvent.EXECUTE,
                                data: resultSet
                            }));
                        }
                    },
                    onRollback: (session, error) => {
                        if (adapter && adapter.canCatchError()) {
                            adapter.rollback(session, error);
                        } else {
                            this.notifyListeners(new SQLiteEvent({
                                source: this,
                                id: SQLiteEvent.ERROR,
                                data: error
                            }));
                        }
                    }
                }));
            }
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    getConfiguration() {
        return this.mConfiguration;
    }

    getCreateTableModel() {
        return this.mConfiguration.getCreateTableModel();
    }

    getCursorFactory() {
        return this.mCursorFactory;
    }

    getDropTableModel() {
        return this.mConfiguration.getDropTableModel();
    }

    getLabel() {
        return this.mConfiguration.getDisplayName();
    }

    getLastQuery() {
        return this.mLastQuery;
    }

    getMode() {
        return this.mConfiguration.getMode();
    }

    getName() {
        return this.mConfiguration.getName();
    }

    getPath() {
        return this.mConfiguration.getPath();
    }

    getQueue(name) {
        return new SQLiteQueue(name, this);
    }

    getSize() {
        return this.mConfiguration.getSize();
    }

    getTables() {
        return TableInfo.getTables();
    }

    getTableNames() {
        return TableInfo.getTableNames();
    }

    getVersion() {
        return this.mConfiguration.getVersion();
    }

    glob(X="", Y="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT glob(" + X + "," + Y + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    hex(X=[], adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT hex('" + Hex.arrayBufferToHex(X) + "')", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    ifnull(X="", Y="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT ifnull(" + (!X ? "NULL" : X) + "," +
                (!Y ? "NULL" : Y) + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    insertQuery({editTable="",nullColumnHack="",initialValues={},adapter=null}={}) {
        if (this.isOpen()) {
            this.insertQueryWithOnConflict({editTable,nullColumnHack,initialValues,conflictAlgorithm:0,catchError:true,adapter});
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    insertQueryOrThrow({editTable="",nullColumnHack="",initialValues={},catchError=false,adapter=null}={}) {
        if (this.isOpen()) {
            this.insertQueryWithOnConflict({editTable,nullColumnHack,initialValues,conflictAlgorithm:0,catchError,adapter});
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    insertQueryWithOnConflict({editTable="",nullColumnHack="",initialValues={},conflictAlgorithm=0,catchError=false,adapter=null}={}) {
        if (this.isOpen()) {
            let sql = "";
            let bindArgs = null;
            let n = DatabaseUtils.countValues(initialValues);
            let size = (initialValues && n > 0) ? n : 0;
            sql += "INSERT" + SQLiteDatabase.CONFLICT_VALUES[conflictAlgorithm] + " INTO " + editTable + '(';
            if (size > 0) {
                bindArgs = new Array(size);
                for (let colName in initialValues) {
                    if (initialValues.hasOwnProperty(colName)) {
                        sql += (i > 0) ? "," : "";
                        sql += colName;
                        bindArgs.push(initialValues[colName]);
                    }
                }
                sql += ')' + " VALUES (";
                for (let i = 0; i < size; i++) {
                    sql += (i > 0) ? ",?" : "?";
                }
            } else {
                sql += nullColumnHack + ") VALUES (NULL";
            }
            sql += ')';
            let statement = this.compileStatement(editTable, sql, bindArgs);
            if (adapter) {
                adapter.setTable(editTable);
                adapter.setCatchError(catchError);
            }
            statement.executeInsert(adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    inTransaction() {
        if (this.isOpen()) {
            return this.mSession.hasTransaction();
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    isInMemoryDatabase() {
        return this.getName() === SQLiteDatabaseConfiguration.MEMORY_DB_PATH;
    }

    isOpen() {
        return this.mOpen;
    }

    isReadOnly() {
        return this.getMode() === SQLiteDatabase.OPEN_READONLY;
    }

    julianday(timestring="", modifiers=[], adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT julianday(" + timestring + (modifiers && modifiers.length ? "," + modifiers.join(",") : "") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    lastInsertRowid(adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT last_insert_rowid()", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    length(X="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT length(" + X + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    like(X="", Y="", Z="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT like(" + X + "," + Y + (Z ? "," + Z : "") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    lower(X="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT lower(" + X + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    ltrim(X="", Y="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT ltrim(" + X + (Y ? "," + Y : "") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    max(values=[], adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT max(" + values.join(",") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    min(values=[], adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT min(" + values.join(",") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    needUpgrade(newVersion) {
        return newVersion > this.getVersion();
    }

    newCursorLoader({id,
                        context,
                        listener,
                        executor,
                        editTable="",
                        projection=[],
                        selection="",
                        selectionArgs=[],
                        groupBy="",
                        having="",
                        sortOrder="",
                        limit=""}={}) {
        return new CursorLoader({
            id,
            context,
            listener,
            executor,
            database: this,
            editTable,
            projection,
            selection,
            selectionArgs,
            groupBy,
            having,
            sortOrder,
            limit
        });
    }

    notifyListeners(evt) {
        let listeners = this.mListeners.getListenersInternal();
        for (const listener of listeners) {
            listener.onHandleEvent(evt);
        }
    }

    nullif(X="", Y="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT nullif(" + (!X ? "NULL" : X) + "," +
                (!Y ? "NULL" : Y) + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    onCorruption(evt) {
        this.notifyListeners(evt);
    }

    open() {
        let configuration = Configuration.getInstance();
        try {
            let mode = this.getMode();
            switch (mode) {
                case SQLiteDatabase.OPEN_READONLY:
                case SQLiteDatabase.OPEN_READWRITE:
                    if (!this.mOpen) {
                        let created = configuration.isDBCreated();
                        this.mDatabase = window.openDatabase(
                            this.mConfiguration.getName(),
                            "" + this.mConfiguration.getVersion(),
                            this.mConfiguration.getSize(),
                            null);
                        if (this.mOpen = (this.mDatabase !==null || this.mDatabase !==undefined)) {
                            configuration.setDBOpened();
                            if (!created) {
                                configuration.setDBCreated(true);
                                let path = this.getCreateTableModel();
                                let parser = new SQLiteParser();
                                let listener = new SQLiteParserListener({
                                    onParseEvent : (evt) => {
                                        let statements = evt.getData();
                                        let queue = new SQLiteTransactionQueue({
                                            database : this,
                                            complete : (manager) => {
                                                this.notifyListeners(new SQLiteEvent({
                                                    source : this,
                                                    id : SQLiteEvent.CREATE
                                                }));
                                            }
                                        });
                                        let createStatement = "CREATE TABLE IF NOT EXISTS ";
                                        for (const statement of statements) {
                                            let idx1 = statement.indexOf(createStatement);
                                            let idx2 = statement.indexOf("(");
                                            if (idx1 !== -1 && idx2 !== -1) {
                                                let tableName = statement.substring(createStatement.length, idx2).trim();
                                                let tableInfo = TableInfo.setTable(tableName, new TableInfo(tableName));
                                                tableInfo.parse(statement);
                                            }
                                            queue.offer({ statement, bindArgs: [] });
                                        }
                                        this.enqueueTransaction(queue);
                                        parser.removeListener(listener);
                                    }
                                });
                                parser.addListener(listener);
                                parser.loadFile(path);
                            } else {
                                this.notifyListeners(new SQLiteEvent({
                                    source : this,
                                    id : SQLiteEvent.OPEN
                                }));
                            }
                        } else {
                            throw new ReferenceError("SQLiteException database not created");
                        }
                    }
                    return this;
            }
        } catch (e) {
            console.log("Failed to open database '" + this.getLabel() + "'." + e.message);
            configuration.setDBCreated(false);
            this.close();
            this.notifyListeners(new SQLiteEvent({
                source : this,
                id : SQLiteEvent.ERROR,
                data : e
            }));
        }
        return null;
    }

    static openOrCreateDatabase({name=null,displayName=null,size=0,version=0,mode=0,path=null,createModel=null,dropModel=null,factory=null}={}) {
        try {
            let database = null;
            let configuration = Configuration.getInstance();
            if (configuration.isDBOn()) {
                let database_name = configuration.getDatabaseName();
                let database_created = sActiveDatabases[database_name] !== null &&
                    sActiveDatabases[database_name] !== undefined;
                configuration.setDBCreated(database_created);
                if (!database_created) {
                    database = SQLiteDatabase.create({name,displayName,size,version,mode,path,createModel,dropModel,factory});
                } else {
                    database = sActiveDatabases[database_name];
                }
                if (database) {
                    return database.open();
                }
            }
            return null;
        } catch (e) {
            throw e;
        }
    }

    query({
              editTable="",
              columns=[],
              selection="",
              selectionArgs=[],
              groupBy="",
              having="",
              orderBy="",
              limit="",
              adapter=null}={}) {
        if (this.isOpen()) {
            this.queryWithFactory({cursorFactory:null,distinct:false,editTable,columns,selection,selectionArgs,groupBy,having,orderBy,limit,adapter});
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    queryWithFactory({
                         cursorFactory,
                         distinct=false,
                         editTable="",
                         columns=[],
                         selection="",
                         selectionArgs=[],
                         groupBy="",
                         having="",
                         orderBy="",
                         limit="",
                         adapter=null}={}) {
        if (this.isOpen()) {
            let query = SQLiteQueryBuilder.buildQueryString(distinct, editTable, columns, selection,groupBy, having, orderBy, limit);
            editTable = DatabaseUtils.findEditTable(editTable);
            this.rawQueryWithFactory({ cursorFactory, query, selectionArgs, editTable, adapter });
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    quote(value="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT quote(" + value + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    rawQuery({editTable="",query="",selectionArgs=[],adapter=null}={}) {
        if (this.isOpen()) {
            this.rawQueryWithFactory({cursorFactory:null,editTable,query,selectionArgs,catchError:false,adapter});
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    rawQueryWithFactory({cursorFactory=null,editTable="",query="",selectionArgs=[],catchError=false,adapter=null}={}) {
        if (this.isOpen()) {
            this.mLastQuery = query;
            let driver = SQLiteCursorDriver.setDriver(query, new SQLiteCursorDriver({
                database : this,
                query,
                editTable
            }));
            if (adapter) {
                adapter.setTable(editTable);
                adapter.setCatchError(catchError);
            }
            driver.query(cursorFactory ? cursorFactory : this.mCursorFactory, selectionArgs, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    removeListener(listener) {
        this.mListeners.remove(listener);
    }

    renameTable(tableName="", newTableName="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("ALTER TABLE " + tableName + " RENAME TO " + newTableName, [], adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    reopenReadWrite() {
        if (!this.isReadOnly()) {
            return;
        }
        this.close();
        this.open();
    }

    replace(X="", Y="", Z="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT replace(" + X + "," + Y + "," + Z + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    replaceQuery({editTable="",nullColumnHack="",initialValues={},adapter=null}={}) {
        if (this.isOpen()) {
            this.insertQueryWithOnConflict({
                editTable,
                nullColumnHack,
                initialValues,
                conflictAlgorithm:5,
                catchError:true,
                adapter});
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    replaceQueryOrThrow({editTable="",nullColumnHack="",initialValues={},adapter=null}={}) {
        if (this.isOpen()) {
            this.insertQueryWithOnConflict({
                editTable,
                nullColumnHack,
                initialValues,
                conflictAlgorithm:5,
                catchError:false,
                adapter});
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    round(X=0, Y=0, adapter=null) {
        if (!Y) {
            Y = 0;
        }
        if (this.isOpen()) {
            this.execSQL("SELECT round(" + X + "," + Y + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    rtrim(X="", Y="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT rtrim(" + X + (Y ? "," + Y : "") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    setCursorFactory(cursorFactory) {
        this.mCursorFactory = cursorFactory;
    }

    setTransactionSuccessful(transaction, result) {
        if (this.isOpen()) {
            this.mSession.setTransactionSuccessful(transaction, result);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    setVersion(newVersion, onChange=null) {
        if (this.isOpen() && this.needUpgrade(newVersion)) {
            this.mDatabase.changeVersion(this.getVersion(),
                newVersion,
                null,
                (error) => {
                    if (onChange) {
                        onChange(-1);
                    } else {
                        let evt = new SQLiteEvent({
                            source: this,
                            id: SQLiteEvent.ERROR,
                            data: error
                        });
                        this.onCorruption(evt);
                        this.notifyListeners(evt);
                    }
                },
                () => {
                    if (onChange) {
                        onChange(1);
                    } else {
                        this.notifyListeners(new SQLiteEvent({
                            source: this,
                            id: SQLiteEvent.CHANGE
                        }));
                    }
                });
        }
    }

    strftime(format="", timestring="", modifiers=[], adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT strftime(" + format + "," + timestring +
                (modifiers && modifiers.length ? "," + modifiers.join(",") : "") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    substr(X="", Y=0, Z=0, adapter=null) {
        if (!Z) {
            Z = X.length - Y;
        }
        if (this.isOpen()) {
            this.execSQL("SELECT substr(" + X + "," + Y + "," + Z + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    throwIfNotOpenLocked() {
        if (!this.isOpen()) {
            throw new ReferenceError("IllegalStateException The database '" + this.getLabel() + "' is not open.");
        }
    }

    time(timestring="", modifiers=[], adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT time(" + timestring + (modifiers && modifiers.length ? "," + modifiers.join(",") : "") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    totalChanges(adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT total_changes()", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    transaction(listener) {
        if (this.isOpen()) {
            this.mDatabase.transaction(listener);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    trim(X="", Y="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT trim(" + X + (Y ? "," + Y : "") + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    typeOf(X="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT typeof(" + X + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    updateQuery({editTable="",query="",values={},bindArgs=[],adapter=null}={}) {
        if (this.isOpen()) {
            this.updateQueryWithOnConflict({editTable,query,values,bindArgs,conflictAlgorithm:0,catchError:true,adapter});
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    updateQueryWithOnConflict({editTable="",query="",values={},bindArgs=[],conflictAlgorithm=5,catchError=false,adapter=null}={}) {
        if (this.isOpen()) {
            let n = DatabaseUtils.countValues(values);
            if (!values || n === 0) {
                throw new RangeError("IllegalArgumentException Empty values");
            }
            let whereArgs = bindArgs;
            let sql = "UPDATE " + SQLiteDatabase.CONFLICT_VALUES[conflictAlgorithm] + editTable + " SET ";
            let setValuesSize = n;
            let bindArgsSize = !whereArgs ? setValuesSize : (setValuesSize + whereArgs.length);
            bindArgs = new Array(bindArgsSize);
            let index = 0;
            for (let colName in values) {
                if (values.hasOwnProperty(colName)) {
                    sql += (index > 0) ? "," : "";
                    sql += colName;
                    bindArgs[index] = values[colName];
                    sql += "=?";
                    index++;
                }
            }
            if (whereArgs) {
                for (let i = setValuesSize; i < bindArgsSize; i++) {
                    bindArgs[i] = whereArgs[i - setValuesSize];
                }
            }
            if (query.length !== 0) {
                sql += " WHERE " + query;
            }
            let statement = this.compileStatement(editTable, sql, bindArgs);
            if (adapter) {
                adapter.setTable(editTable);
                adapter.setCatchError(catchError);
            }
            statement.executeUpdateDelete(adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }

    upper(X="", adapter=null) {
        if (this.isOpen()) {
            this.execSQL("SELECT upper(" + X + ")", null, adapter);
        } else {
            this.throwIfNotOpenLocked();
        }
    }
}

SQLiteDatabase.CONFLICT_ROLLBACK = 1;
SQLiteDatabase.CONFLICT_ABORT = 2;
SQLiteDatabase.CONFLICT_FAIL = 3;
SQLiteDatabase.CONFLICT_IGNORE = 4;
SQLiteDatabase.CONFLICT_REPLACE = 5;
SQLiteDatabase.CONFLICT_NONE = 0;
SQLiteDatabase.CONFLICT_VALUES = [ "", " OR ROLLBACK ", " OR ABORT ", " OR FAIL ", " OR IGNORE ", " OR REPLACE " ];
SQLiteDatabase.SQLITE_MAX_LIKE_PATTERN_LENGTH = 50000;
SQLiteDatabase.OPEN_READONLY = 0x00000001;
SQLiteDatabase.OPEN_READWRITE = 0x00000002;
SQLiteDatabase.MAX_SQL_CACHE_SIZE = 100;
SQLiteDatabase.DEFAULT_SIZE = 5 * 1024 * 1024;
SQLiteDatabase.DEFAULT_PATH = "./";
SQLiteDatabase.DEFAULT_VERSION = "1.0";

