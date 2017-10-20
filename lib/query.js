/** @babel */
import {SQLiteEvent, SQLiteTransactionListener} from "./event";
import {BaseColumns, DatabaseUtils, TableInfo} from "./helper";
import {ExecCursor} from "./cursor";

export class SQLiteProgram {

    constructor({database, editTable = "", query = "", bindArgs = []} = {}) {
        if (!database) {
            throw new ReferenceError("NullPointerException database is null");
        }
        this.mDatabase = database;
        this.mSql = query.trim();
        this.mBindArgs = [];
        this.mSession = null;
        this.mReadOnly = true;
        let n = DatabaseUtils.getSqlStatementType(this.mSql);
        switch (n) {
            case DatabaseUtils.STATEMENT_BEGIN:
            case DatabaseUtils.STATEMENT_COMMIT:
            case DatabaseUtils.STATEMENT_ABORT:
                this.mReadOnly = false;
                this.mColumnNames = [];
                this.mNumParameters = 0;
                break;
            default:
                let tableInfo = TableInfo.getTable(editTable);
                if (!tableInfo) {
                    let query = "SELECT sql FROM sqlite_master WHERE name = '" + editTable + "'";
                    this.mDatabase.beginTransaction(query, [],
                        new SQLiteTransactionListener({
                            onBegin: (session) => {
                            },
                            onCommit: (session, resultSet) => {
                                let rows = resultSet.rows;
                                let len = rows.length;
                                for (let i = 0; i < len; i++) {
                                    let row = rows.item(i);
                                    for (let p in row) {
                                        if (row.hasOwnProperty(p)) {
                                            if (p === "sql") {
                                                let statements = row[p];
                                                let tableInfo = new TableInfo(editTable);
                                                tableInfo.parse(statements);
                                                this.mColumnNames = tableInfo.getColumnNames();
                                                this.mNumParameters = this.mColumnNames.length;
                                                TableInfo.setTable(editTable, tableInfo);
                                                this.notifyChange(tableInfo);
                                                break;
                                            }
                                        }
                                    }
                                }
                            },
                            onRollback: (session, error) => {
                                this.notifyError(error);
                            }
                        }));

                } else {
                    this.mColumnNames = tableInfo.getColumnNames();
                    this.mNumParameters = this.mColumnNames.length;
                    this.setBindings(bindArgs);
                    this.mDatabase.notifyListeners(
                        new SQLiteEvent({
                            source: this,
                            id: SQLiteEvent.CHANGE,
                            data: tableInfo
                        })
                    );
                }
                break;
        }
    }

    bind(index = 0, value = null) {
        if (index < 1 || index > this.mNumParameters) {
            console.log("index: " + index + ", value: " + value + ", mNumParameters: " + this.mNumParameters);
            throw new RangeError(
                "IllegalArgumentException Cannot bind argument at index "
                + index
                + " because the index is out of range.  "
                + "The statement has "
                + this.mNumParameters
                + " parameters.");
        }
        this.mBindArgs[index - 1] = value;
    }

    bindAllArgsAsStrings(bindArgs = []) {
        if (bindArgs) {
            for (let i = bindArgs.length; i !== 0; i--) {
                this.bindString(i, bindArgs[i - 1]);
            }
        }
    }

    bindBlob(index = 0, value = null) {
        if (value === null) {
            throw new ReferenceError("IllegalArgumentException the bind value at index " + index + " is null");
        }
        this.bind(index, DatabaseUtils.toBlob(value));
    }

    bindDouble(index = 0, value = null) {
        this.bind(index, value);
    }

    bindLong(index = 0, value = null) {
        this.bind(index, value);
    }

    bindNull(index = 0) {
        this.bind(index, null);
    }

    bindString(index = 0, value = null) {
        if (value === null) {
            throw new RangeError("IllegalArgumentException the bind value at index " + index + " is null");
        }
        this.bind(index, value);
    }

    clearBindings() {
        if (this.mBindArgs) {
            this.mBindArgs = new Array(this.mNumParameters);
        }
    }

    execute(listener) {
        this.mDatabase.beginTransaction(this.getQuery(), this.getBindArgs(), listener);
    }

    getBindArgs() {
        return this.mBindArgs;
    }

    getColumnNames() {
        return this.mColumnNames;
    }

    getDatabase() {
        return this.mDatabase;
    }

    getQuery() {
        return this.mSql;
    }

    isReadOnly() {
        return this.mReadOnly;
    }

    notifyChange(data) {
        this.mDatabase.notifyListeners(new SQLiteEvent({
            source: this.mDatabase, id: SQLiteEvent.CHANGE, data: data
        }));
    }

    notifyError(error) {
        this.mDatabase.notifyListeners(new SQLiteEvent({
            source: this.mDatabase, id: SQLiteEvent.ERROR, data: error
        }));
    }

    setBindings(bindArgs = []) {
        if (bindArgs && bindArgs.length > this.mNumParameters) {
            throw new RangeError("IllegalArgumentException Too many bind arguments.  " +
                bindArgs.length + " arguments were provided but the statement needs " +
                this.mNumParameters + " arguments.");
        }
        if (this.mNumParameters !== 0) {
            this.mBindArgs = bindArgs;
        }
    }

    setQuery(query = null) {
        if (query) {
            this.mSql = query.trim();
        }
    }

    toString() {
        return "SQLiteProgram: " + this.getQuery();
    }

}

export class SQLiteQuery extends SQLiteProgram {

    constructor({database, editTable = "", query = "", bindArgs = []} = {}) {
        super({database, editTable, query, bindArgs});
    }

    toString() {
        return "SQLiteQuery: " + this.getQuery();
    }

}

const STATEMENTS = new Map();

export class SQLiteStatement extends SQLiteProgram {

    constructor({database, editTable = "", query = "", bindArgs = []} = {}) {
        super({database, editTable, query, bindArgs});
    }

    commitAdapter(adapter = null, session = null, resultSet = null) {
        if (adapter) {
            let database = this.mDatabase;
            let table = TableInfo.getTable(adapter.getTable());
            adapter.commit(session, new ExecCursor({database, table, resultSet}));
        }
    }

    createTransitionListener(adapter = null) {
        return new SQLiteTransactionListener({
            onBegin: (session) => {
                if (adapter) {
                    adapter.begin(session);
                }
            },
            onCommit: (session, resultSet) => {
                if (adapter) {
                    this.commitAdapter(adapter, session, resultSet);
                } else {
                    this.notifyExecute(resultSet);
                }
            },
            onRollback: (session, error) => {
                if (adapter && adapter.canCatchError()) {
                    adapter.rollback(session, error);
                } else {
                    this.notifyError(error);
                }
            }
        })
    }

    execute(adapter = null) {
        let sql = this.getQuery();
        let parameters = this.getBindArgs();
        this.mDatabase.beginTransaction(sql, parameters, this.createTransitionListener(adapter));
    }

    executeInsert(adapter = null) {
        let sql = this.getQuery();
        let parameters = this.getBindArgs();
        if (!(sql.indexOf(DatabaseUtils.INSERT) !== -1 || sql.indexOf(DatabaseUtils.INSERT.toLowerCase()) !== -1)) {
            this.notifyError(new SyntaxError("SQLException " + sql + " not an insert statement"));
        } else {
            this.mDatabase.beginTransaction(sql, parameters, this.createTransitionListener(adapter));
        }
    }

    executeUpdateDelete(adapter = null) {
        let sql = this.getQuery();
        let parameters = this.getBindArgs();
        if (!(sql.indexOf(DatabaseUtils.UPDATE) !== -1
            || sql.indexOf(DatabaseUtils.UPDATE.toLowerCase()) !== -1
            || sql.indexOf(DatabaseUtils.DELETE) !== -1
            || sql.indexOf(DatabaseUtils.DELETE.toLowerCase()) !== -1)) {
            this.notifyError(new SyntaxError("SQLException " + sql + " not an update or delete statement"));
        } else {
            this.mDatabase.beginTransaction(sql, parameters, this.createTransitionListener(adapter));
        }
    }

    static getStatements(sql) {
        return STATEMENTS.get(sql);
    }

    rollbackAdapter(adapter = null, session = null, error = null) {
        if (adapter) {
            adapter.rollback(session, error);
        } else {
            this.notifyExecute(error);
        }
    }

    static setStatements(sql, statment) {
        if (!STATEMENTS.has(sql)) {
            STATEMENTS.set(sql, statment);
        }
        return STATEMENTS.get(sql);
    }

    simpleQueryForLong(adapter = null) {
        let sql = this.getQuery();
        let parameters = this.getBindArgs();
        this.mDatabase.beginTransaction(
            sql,
            parameters,
            new SQLiteTransactionListener({
                onBegin: (session) => {
                    if (adapter) {
                        adapter.begin(session);
                    }
                },
                onCommit: (session, resultSet) => {
                    let error = null;
                    let rows = resultSet.rows;
                    if (rows.length !== 1) {
                        error = new ReferenceError("SQLException " + sql + " no result found");
                        this.rollbackAdapter(adapter, session, error);
                    } else {
                        let row = rows[0];
                        for (let p in row) {
                            if (row.hasOwnProperty(p)) {
                                if (typeof row[p] !== "number") {
                                    error = new TypeError("SQLException " + row[p] + " not a number");
                                    this.rollbackAdapter(adapter, session, error);
                                    break;
                                } else {
                                    if (adapter) {
                                        this.commitAdapter(adapter, session, resultSet);
                                    } else {
                                        this.notifyExecute(row[p]);
                                    }
                                    break;
                                }
                            }
                        }
                    }
                },
                onRollback: (session, error) => {
                    if (adapter && adapter.canCatchError()) {
                        adapter.rollback(session, error);
                    } else {
                        this.notifyError(error);
                    }
                }
            })
        );
    }

    simpleQueryForString(adapter = null) {
        let sql = this.getQuery();
        let parameters = this.getBindArgs();
        this.mDatabase.beginTransaction(
            sql,
            parameters,
            new SQLiteTransactionListener({
                onBegin: (session) => {
                    if (adapter) {
                        adapter.begin(session);
                    }
                },
                onCommit: (session, resultSet) => {
                    let error = null;
                    let rows = resultSet.rows;
                    if (rows.length !== 1) {
                        error = new ReferenceError("SQLException " + sql + " no result found");
                        this.rollbackAdapter(adapter, session, error);
                    } else {
                        let row = rows[0];
                        for (let p in row) {
                            if (row.hasOwnProperty(p)) {
                                if (typeof row[p] !== "string") {
                                    error = new TypeError("SQLException " + row[p] + " not a string");
                                    this.rollbackAdapter(adapter, session, error);
                                    break;
                                } else {
                                    if (adapter) {
                                        this.commitAdapter(adapter, session, resultSet);
                                    } else {
                                        this.notifyExecute(row[p]);
                                    }
                                    break;
                                }
                            }
                        }
                    }
                },
                onRollback: (session, error) => {
                    if (adapter && adapter.canCatchError()) {
                        adapter.rollback(session, error);
                    } else {
                        this.notifyError(error);
                    }
                }
            })
        );
    }

    notifyExecute(result) {
        this.mDatabase.notifyListeners(new SQLiteEvent({
            source: this,
            id: SQLiteEvent.EXECUTE,
            data: result
        }));
    }

    toString() {
        return "SQLiteStatement: " + this.getQuery();
    }
}

export class SQLiteQueryBuilder {

    constructor() {
        this.mProjectionMap = null;
        this.mTables = null;
        this.mWhereClause = null;
        this.mDistinct = false;
        this.mFactory = null;
        this.mStrict = false;
    }

    appendWhere(inWhere = false) {
        if (!this.mWhereClause) {
            this.mWhereClause = "";
        }
        if (this.mWhereClause.length === 0) {
            this.mWhereClause += '(';
        }
        this.mWhereClause += inWhere;
    }

    static appendClause(query = "", name = "", clause = "") {
        if (clause.length > 0) {
            query += name + clause;
        }
        return query;
    }

    static appendColumns(query = "", columns = []) {
        let n = columns.length;
        for (let i = 0; i < n; i++) {
            let column = columns[i];
            if (column) {
                if (i > 0) {
                    query += ", ";
                }
                query += column;
            }
        }
        return query += ' ';
    }

    appendWhereEscapeString(inWhere = false) {
        if (!this.mWhereClause) {
            this.mWhereClause = "";
        }
        if (this.mWhereClause.length === 0) {
            this.mWhereClause += '(';
        }
        this.mWhereClause = DatabaseUtils.appendEscapedSQLString(this.mWhereClause, inWhere);
    }

    buildQuery(projectionIn = null, selection = "", groupBy = null, having = null, sortOrder = null, limit = null) {
        let projection = this.computeProjection(projectionIn);
        let where = "";
        let hasBaseWhereClause = this.mWhereClause && this.mWhereClause.length > 0;
        if (hasBaseWhereClause) {
            where += this.mWhereClause;
            where += ')';
        }
        if (selection && selection.length > 0) {
            if (hasBaseWhereClause) {
                where += " AND ";
            }
            where += '(' + selection + ')';
        }
        return SQLiteQueryBuilder.buildQueryString(this.mDistinct, this.mTables, projection, where, groupBy, having, sortOrder, limit);
    }

    static buildQueryString(distinct = false, tables = "", columns = [], where = "", groupBy = "", having = "", orderBy = "", limit = "") {
        if ((groupBy && groupBy.length === 0) && (having && having.length > 0)) {
            throw new SyntaxError("IllegalArgumentException HAVING clauses are only permitted when using a groupBy clause");
        }
        if (limit && limit.length > 0 && !limit.test('^[0-9]+$')) {
            throw new TypeError("IllegalArgumentException invalid LIMIT clauses:" + limit);
        }
        let query = "SELECT ";
        if (distinct) {
            query += "DISTINCT ";
        }
        if (columns && columns.length > 0) {
            query = SQLiteQueryBuilder.appendColumns(query, columns);
        } else {
            query += "* ";
        }
        query += "FROM ";
        query += tables;
        query = SQLiteQueryBuilder.appendClause(query, " WHERE ", where);
        query = SQLiteQueryBuilder.appendClause(query, " GROUP BY ", groupBy);
        query = SQLiteQueryBuilder.appendClause(query, " HAVING ", having);
        query = SQLiteQueryBuilder.appendClause(query, " ORDER BY ", orderBy);
        query = SQLiteQueryBuilder.appendClause(query, " LIMIT ", limit);
        return query;
    }

    buildUnionQuery(subQueries = [], sortOrder = "", limit = "") {
        let query = "";
        let subQueryCount = subQueries.length;
        let unionOperator = this.mDistinct ? " UNION " : " UNION ALL ";
        for (let i = 0; i < subQueryCount; i++) {
            if (i > 0) {
                query += unionOperator;
            }
            query += subQueries[i];
        }
        SQLiteQueryBuilder.appendClause(query, " ORDER BY ", sortOrder);
        SQLiteQueryBuilder.appendClause(query, " LIMIT ", limit);
        return query;
    }

    buildUnionSubQuery(typeDiscriminatorColumn = "",
                       unionColumns = [],
                       columnsPresentInTable = [],
                       computedColumnsOffset = 0,
                       typeDiscriminatorValue = null,
                       selection = "",
                       groupBy = "",
                       having = "") {
        let unionColumnsCount = unionColumns.length;
        let projectionIn = new Array(unionColumnsCount);
        for (let i = 0; i < unionColumnsCount; i++) {
            let unionColumn = unionColumns[i];
            if (unionColumn === typeDiscriminatorColumn) {
                projectionIn[i] = "'" + typeDiscriminatorValue + "' AS " + typeDiscriminatorColumn;
            } else if (i <= computedColumnsOffset || columnsPresentInTable.indexOf(unionColumn) !== -1) {
                projectionIn[i] = unionColumn;
            } else {
                projectionIn[i] = "NULL AS " + unionColumn;
            }
        }
        return this.buildQuery(projectionIn, selection, groupBy, having, null, null);
    }

    computeProjection(projectionIn = []) {
        if (projectionIn && projectionIn.length > 0) {
            if (this.mProjectionMap) {
                let length = projectionIn.length;
                let projection = new Array(length);
                for (let i = 0; i < length; i++) {
                    let userColumn = projectionIn[i];
                    let column = this.mProjectionMap[userColumn];
                    if (column) {
                        projection[i] = column;
                        continue;
                    }
                    if (!this.mStrict && (userColumn.indexOf(" AS ") !== -1 || userColumn.indexOf(" as ") !== -1)) {
                        projection[i] = userColumn;
                        continue;
                    }
                    throw new RangeError("IllegalArgumentException Invalid column " + projectionIn[i]);
                }
                return projection;
            } else {
                return projectionIn;
            }
        } else if (this.mProjectionMap) {
            let projection = [];
            for (let p in this.mProjectionMap) {
                if (this.mProjectionMap.hasOwnProperty(p)) {
                    if (p === BaseColumns._COUNT) {
                        continue;
                    }
                    projection.push(this.mProjectionMap[p]);
                }
            }
            return projection;
        }
        return null;
    }

    getTables() {
        return this.mTables;
    }

    query({database, projection = [], selection = "", selectionArgs = [], groupBy = "", having = "", sortOrder = "", limit = "", adapter = null} = {}) {
        if (!database) {
            throw new ReferenceError("NullPointerException database is null");
        }
        if (!this.mTables) {
            return null;
        }
        if (this.mStrict && selection && selection.length > 0) {
            let sqlForValidation = this.buildQuery(projection, "(" + selection + ")", groupBy, having, sortOrder, limit);
            this.validateQuerySql(database, sqlForValidation);
        }
        let query = this.buildQuery(projection, selection, groupBy, having, sortOrder, limit);
        console.log("Performing query: " + query);
        let editTable = DatabaseUtils.findEditTable(this.mTables);
        let cursorFactory = this.mFactory;
        database.rawQueryWithFactory({cursorFactory, query, selectionArgs, editTable, adapter});
    }

    setCursorFactory(factory) {
        this.mFactory = factory;
    }

    setDistinct(distinct) {
        this.mDistinct = distinct;
    }

    setProjectionMap(columnMap) {
        this.mProjectionMap = columnMap;
    }

    setStrict(flag) {
        this.mStrict = flag;
    }

    setTables(inTables) {
        this.mTables = inTables;
    }

    validateQuerySql(db, sql) {
    }
}


