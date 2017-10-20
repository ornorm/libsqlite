/** @babel */
import {ContentObservable, DataSetObservable} from "hjs-content/lib/dataset";
import {AsyncTaskLoader} from "hjs-content/lib/loader";
import {SQLiteEvent, SQLiteListener, SQLiteTransactionListener} from "./event";
import {SQLiteQuery, SQLiteQueryBuilder} from "./query";
import {DatabaseUtils, Hex} from "./helper";

const DRIVERS = new Map();

export class SQLiteCursorDriver {

    constructor({database=null,editTable=null,query=null}={}) {
        this.mDatabase = database;
        this.mEditTable = editTable;
        this.mSql = query;
    }

    getDatabase() {
        return this.mDatabase;
    }

    static getDriver(query) {
        return DRIVERS.get(query) || null;
    }

    getQuery() {
        return this.mQuery;
    }

    getStatement() {
        return this.mSql;
    }

    getTableName() {
        return this.mEditTable;
    }

    notifyError(error) {
        this.mDatabase.notifyListeners(new SQLiteEvent({
            source : this.mDatabase,
            id : SQLiteEvent.ERROR,
            data : error
        }))
    }

    query(factory=null, bindArgs=[], adapter=null) {
        let database = this.mDatabase;
        let table = this.mEditTable;
        let query = new SQLiteQuery({
            database,
            editTable : table,
            query : this.mSql,
            bindArgs
        });
        query.bindAllArgsAsStrings(selectionArgs);
        query.execute(new SQLiteTransactionListener({
            onBegin: (session) => {
                if (adapter) {
                    adapter.begin(session);
                }
            },
            onCommit: (session, resultSet) => {
                let cursor = null;
                if (!factory) {
                    cursor = new SQLiteCursor({
                        driver : this, table, query, bindArgs, resultSet
                    });
                } else {
                    cursor = factory.newCursor({
                        driver : this, editTable : table, query, bindArgs, resultSet
                    });
                }
                if (cursor) {
                    if (adapter) {
                        adapter.commit(session, cursor);
                    } else {
                        this.mDatabase.notifyListeners(new SQLiteEvent({
                            source : this.mDatabase,
                            id : SQLiteEvent.EXECUTE,
                            data : cursor
                        }));
                    }
                } else {
                    this.notifyError(new ReferenceError("SQLException null cursor"));
                }
            },
            onRollback: (session, error) => {
                console.log("GET ERROR " + error.message);
                if (adapter && adapter.canCatchError()) {
                    adapter.rollback(session, error);
                } else {
                    this.notifyError(error);
                }
            }
        }));
        this.mQuery = query;
    }

    setBindArguments(bindArgs) {
        this.mQuery.bindAllArgsAsStrings(bindArgs);
    }

    static setDriver(query, driver) {
        if (!DRIVERS.has(query)) {
            DRIVERS.set(query, driver);
        }
        return DRIVERS.get(query);
    }

    toString() {
        return "SQLiteCursorDriver: " + this.mSql;
    }
}

export class Cursor {

    constructor() {
        this.mPos = -1;
        this.mClosed = false;
        this.mSelfObserver = null;
        this.mSelfObserverRegistered = false;
        this.mDataSetObservable = new DataSetObservable();
        this.mContentObservable = new ContentObservable();
    }

    checkPosition() {
        if (this.mPos === -1 || this.getCount() === this.mPos) {
            throw new RangeError("CursorIndexOutOfBoundsException At " + this.mPos + "/" + this.getCount());
        }
    }

    close() {
        this.mClosed = true;
        this.mContentObservable.unregisterAll();
        this.onDeactivateOrClose();
    }

    copyStringToBuffer(columnIndex=0, buffer=[]) {
        let result = this.getString(columnIndex);
        if (result) {
            let len = result.length;
            for (let i = 0; i < len; i++) {
                buffer[i] = result.getCharAt(i);
            }
        }
    }

    finalize() {
        if (this.mSelfObserver && this.mSelfObserverRegistered) {
            //mContentResolver.unregisterContentObserver(mSelfObserver);
        }
        if (!this.mClosed) {
            this.close();
        }
    }

    getBlob(columnIndex=0) {
        return null;
    }

    getColumnCount() {
        let columns = this.getColumnNames();
        return columns.length;
    }

    getColumnIndex(columnName="") {
        let periodIndex = columnName.lastIndexOf('.');
        if (periodIndex !== -1) {
            console.log("requesting column name with table name -- " + columnName);
            columnName = columnName.substring(periodIndex + 1);
        }
        let columnNames = this.getColumnNames();
        let length = columnNames.length;
        for (let i = 0; i < length; i++) {
            let column = columnNames[i];
            if (column.toLowerCase() === columnName.toLowerCase()) {
                return i;
            }
        }
        if (this.getCount() > 0) {
            console.log("Unknown column " + columnName);
        }
        return -1;
    }

    getColumnIndexOrThrow(columnName="") {
        let index = this.getColumnIndex(columnName);
        if (index < 0) {
            throw new ReferenceError("IllegalArgumentException column '" + columnName + "' does not exist");
        }
        return index;
    }

    getColumnName(columnIndex=0) {
        let columns = this.getColumnNames();
        return columns[columnIndex] || null;
    }

    getColumnNames() {
        return null;
    }

    getCount() {
        return 0;
    }

    getDouble(columnIndex=0) {
        return 0.0;
    }

    getFloat(columnIndex=0) {
        return 0;
    }

    getInt(columnIndex=0) {
        return 0;
    }

    getLong(columnIndex=0) {
        return 0;
    }

    getPosition() {
        return this.mPos;
    }

    getShort(columnIndex=0) {
        return 0;
    }

    getString(columnIndex=0) {
        return null;
    }

    getType(columnIndex=0) {
        return Cursor.FIELD_TYPE_STRING;
    }

    getUpdatedField(columnIndex=0) {
        return null;
    }

    isAfterLast() {
        let count = this.getCount();
        if (count === 0) {
            return true;
        }
        return this.mPos === count;
    }

    isBeforeFirst() {
        let count = this.getCount();
        if (count === 0) {
            return true;
        }
        return this.mPos === -1;
    }

    isClosed() {
        return this.mClosed;
    }

    isFieldUpdated(columnIndex=0) {
        return false;
    }

    isFirst() {
        return this.mPos === 0 && this.getCount() !== 0;
    }

    isLast() {
        let count = this.getCount();
        return this.mPos === (count - 1) && count !== 0;
    }

    isNull(columnIndex=0) {
        return false;
    }

    move(offset=0) {
        return this.moveToPosition(this.mPos + offset);
    }

    moveToFirst() {
        return this.moveToPosition(0);
    }

    moveToLast() {
        return this.moveToPosition(this.getCount() - 1);
    }

    moveToNext() {
        return this.moveToPosition(this.mPos + 1);
    }

    moveToPosition(position=0) {
        let count = this.getCount();
        if (position >= count) {
            this.mPos = count;
            return false;
        }
        if (position < 0) {
            this.mPos = -1;
            return false;
        }
        if (position === this.mPos) {
            return true;
        }
        let result = this.onMove(this.mPos, position);
        if (!result) {
            this.mPos = -1;
        } else {
            this.mPos = position;
        }
        return result;
    }

    moveToPrevious() {
        return this.moveToPosition(this.mPos - 1);
    }

    onChange(selfChange=false) {
        this.mContentObservable.dispatchChange(selfChange, null);
    }

    onDeactivateOrClose() {
        if (this.mSelfObserver) {
            this.mSelfObserverRegistered = false;
        }
        this.mDataSetObservable.notifyInvalidated();
    }

    onMove(oldPosition=-1, newPosition=0) {
        return true;
    }

    registerContentObserver(observer) {
        this.mContentObservable.registerObserver(observer);
    }

    registerDataSetObserver(observer) {
        this.mDataSetObservable.registerObserver(observer);
    }

    requery() {
        if (this.mSelfObserver && this.mSelfObserverRegistered === false) {
            this.mSelfObserverRegistered = true;
        }
        this.mDataSetObservable.notifyChanged();
        return true;
    }

    unregisterContentObserver(observer) {
        if (!this.mClosed) {
            this.mContentObservable.unregisterObserver(observer);
        }
    }

    unregisterDataSetObserver(observer) {
        this.mDataSetObservable.unregisterObserver(observer);
    }

}
Cursor.FIELD_TYPE_NULL = 0;
Cursor.FIELD_TYPE_INTEGER = 1;
Cursor.FIELD_TYPE_FLOAT = 2;
Cursor.FIELD_TYPE_STRING = 3;
Cursor.FIELD_TYPE_BLOB = 4;

export class ExecCursor extends Cursor {

    constructor({database,tableInfo=null,resultSet}={}) {
        super();
        if (!database) {
            throw new ReferenceError("IllegalArgumentException database object cannot be null");
        }
        if (!resultSet) {
            throw new ReferenceError("IllegalArgumentException resultSet object cannot be null");
        }
        this.mColumnNameMap = null;
        this.mDatabase = database;
        this.mResultSet = resultSet;
        let table = tableInfo;
        if (table) {
            this.mColumns = table.getColumnNames();
        } else {
            this.mColumns = [];
            let len = this.mResultSet.rows.length;
            for (let i=0; i<len; i++) {
                let row = this.mResultSet.rows[i];
                for (let p in row) {
                    if (row.hasOwnProperty(p)) {
                        this.mColumns.push(p);
                    }
                }
            }
        }
    }

    fillWindow(requiredPos=0) {
        let len = this.mResultSet.rows.length;
        if (this.mCount === SQLiteCursor.NO_COUNT) {
            this.mRows = [];
            let num = len;
            let rows = this.mResultSet.rows;
            for (let i = requiredPos; i < len; i++) {
                let row = rows[i];
                if (row) {
                    this.mRows[i] = row;
                } else {
                    num--;
                }
            }
            this.mCount = num;
        } else {
            this.mCount = len - requiredPos;
            this.mRows = this.mRows.splice(requiredPos, this.mCount);
        }
        console.log("received count(*) from fillWindow: " + this.mCount);
    }

    getBlob(columnIndex=0) {
        this.checkPosition();
        let value = this.getValue(columnIndex);
        return Hex.hexToArrayBuffer(value);
    }

    getColumnIndex(columnName="") {
        if (!this.mColumnNameMap) {
            let columns = this.mColumns;
            let columnCount = columns.length;
            let map = {};
            let rows = this.mResultSet.rows;
            for (let i = 0; i < columnCount; i++) {
                map[columns[i]] = i;
            }
            this.mColumnNameMap = map;
        }
        let periodIndex = columnName.lastIndexOf('.');
        if (periodIndex !== -1) {
            console.log("requesting column name with table name -- " + columnName);
            columnName = columnName.substring(periodIndex + 1);
        }
        let i = this.mColumnNameMap[columnName];
        if (i !== null || i !== undefined) {
            return i;
        }
        return -1;
    }

    getColumnNames() {
        return this.mColumns;
    }

    getCount() {
        if (this.mCount === SQLiteCursor.NO_COUNT) {
            this.fillWindow(0);
        }
        return this.mCount;
    }

    getDatabase() {
        return this.mDatabase;
    }

    getDouble(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getFloat(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getInt(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getLong(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getShort(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getString(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getType(columnIndex=0) {
        this.checkPosition();
        return DatabaseUtils.getTypeOfObject(this.getValue(columnIndex));
    }

    getValue(columnIndex=0) {
        let row = this.mResultSet.rows[this.mPos];
        return row[this.mColumns[columnIndex]];
    }

    insertId() {
        try {
            return this.mResultSet.insertId;
        } catch(e) {
            return -1;
        }
    }

    isBlob(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_BLOB;
    }

    isFloat(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_FLOAT;
    }

    isInt(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_INTEGER;
    }

    isNull(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_NULL;
    }

    isString(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_STRING;
    }

    onMove(oldPosition=-1, newPosition=0) {
        if (!this.mRows || newPosition >= this.mRows.length) {
            this.fillWindow(newPosition);
        }
        return true;
    }

    requery() {
        if (this.mRows) {
            this.mRows = [];
        }
        this.mPos = -1;
        this.mCount = SQLiteCursor.NO_COUNT;
    }

    rowsAffected() {
        return this.mResultSet.rowsAffected;
    }

    setWindow(resultSet={}) {
        this.mResultSet = resultSet;
        this.mCount = SQLiteCursor.NO_COUNT;
    }

}

export class SQLiteCursor extends Cursor {

    constructor({driver,editTable,query,resultSet}={}) {
        super();
        if (!query) {
            throw new ReferenceError("IllegalArgumentException query object cannot be null");
        }
        if (!resultSet) {
            throw new ReferenceError("IllegalArgumentException resultSet object cannot be null");
        }
        this.mColumnNameMap = null;
        this.mDriver = driver;
        this.mEditTable = editTable;
        this.mQuery = query;
        this.mResultSet = resultSet;
        this.mColumns = query.getColumnNames();
    }

    fillWindow(requiredPos=0) {
        let len = this.mResultSet.rows.length;
        if (this.mCount === SQLiteCursor.NO_COUNT) {
            this.mRows = [];
            let num = len;
            let rows = this.mResultSet.rows;
            for (let i = requiredPos; i < len; i++) {
                let row = rows[i];
                if (row) {
                    this.mRows[i] = rows[i];
                } else {
                    num--;
                }
            }
            this.mCount = num;
        } else {
            this.mCount = len - requiredPos;
            this.mRows = this.mRows.splice(requiredPos, this.mCount);
        }
        console.log("received count(*) from fillWindow: " + this.mCount);
    }

    getBlob(columnIndex=0) {
        this.checkPosition();
        let value = this.getValue(columnIndex);
        return Hex.hexToArrayBuffer(value);
    }

    getColumnIndex(columnName="") {
        if (!this.mColumnNameMap) {
            let columns = this.mColumns;
            let columnCount = columns.length;
            let map = {};
            let rows = this.mResultSet.rows;
            for (let i = 0; i < columnCount; i++) {
                map[columns[i]] = i;
            }
            this.mColumnNameMap = map;
        }
        let periodIndex = columnName.lastIndexOf('.');
        if (periodIndex !== -1) {
            console.log("requesting column name with table name -- " + columnName);
            columnName = columnName.substring(periodIndex + 1);
        }
        let i = this.mColumnNameMap[columnName];
        if (i !== null || i !== undefined) {
            return i;
        }
        return -1;
    }

    getColumnNames() {
        return this.mColumns;
    }

    getCount() {
        if (this.mCount === SQLiteCursor.NO_COUNT) {
            this.fillWindow(0);
        }
        return this.mCount;
    }

    getDouble(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getFloat(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getInt(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getLong(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getShort(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getString(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

    getType(columnIndex=0) {
        this.checkPosition();
        return DatabaseUtils.getTypeOfObject(this.getValue(columnIndex));
    }

    getValue(columnIndex=0) {
        let row = this.mResultSet.rows[this.mPos];
        return row[this.mColumns[columnIndex]];
    }

    insertId() {
        try {
            return this.mResultSet.insertId;
        } catch(e) {
            return -1;
        }
    }

    isBlob(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_BLOB;
    }

    isFloat(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_FLOAT;
    }

    isInt(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_INTEGER;
    }

    isNull(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_NULL;
    }

    isString(columnIndex=0) {
        return this.getType(columnIndex) === Cursor.FIELD_TYPE_STRING;
    }

    onMove(oldPosition=-1, newPosition=0) {
        if (!this.mRows || newPosition >= this.mRows.length) {
            this.fillWindow(newPosition);
        }
        return true;
    }

    requery() {
        if (this.mRows) {
            this.mRows = [];
        }
        this.mPos = -1;
        this.mCount = SQLiteCursor.NO_COUNT;
    }

    rowsAffected() {
        return this.mResultSet.rowsAffected;
    }

    setSelectionArguments(selectionArgs=[]) {
        this.mDriver.setBindArguments(selectionArgs);
    }

    setWindow(resultSet={}) {
        this.mResultSet = resultSet;
        this.mCount = SQLiteCursor.NO_COUNT;
    }

}
SQLiteCursor.NO_COUNT = -1;

export class CursorFactory extends SQLiteListener {

    constructor({onHandleEvent = null, newCursor = null }={}) {
        super({onHandleEvent});
        if (newCursor) {
            this.newCursor = newCursor;
        }
    }

    newCursor({}={}) {
        return new SQLiteCursor({});
    }

    getDatabase() {
        return this.mQuery.getDatabase();
    }

    getDouble(columnIndex=0) {
        this.checkPosition();
        return this.getValue(columnIndex);
    }

}

export class CursorLoader extends AsyncTaskLoader {

    constructor({
                    id,
                    context,
                    listener,
                    executor,
                    database,
                    editTable="",
                    projection=[],
                    selection="",
                    selectionArgs=[],
                    groupBy="",
                    having="",
                    sortOrder="",
                    limit=""}={}) {
        super({id,context,listener,executor});
        this.mDatabase = database;
        this.mTables = editTable;
        this.mProjection = projection;
        this.mSelection = selection;
        this.mSelectionArgs = selectionArgs;
        this.mGroupBy = groupBy;
        this.mHaving = having;
        this.mSortOrder = sortOrder;
        this.mLimit = limit;
    }

    deliverResult(cursor=null) {
        if (this.isReset()) {
            if (cursor) {
                cursor.close();
            }
            return;
        }
        let oldCursor = this.mCursor;
        this.mCursor = cursor;
        if (this.isStarted()) {
            super.deliverResult(cursor);
        }
        if (oldCursor && oldCursor !== cursor && !oldCursor.isClosed()) {
            oldCursor.close();
        }
    }

    loadInBackground(task) {
        if (this.isLoadInBackgroundCanceled()) {
            throw new Error("OperationCanceledException");
        }
        let qb = new SQLiteQueryBuilder();
        qb.setTables(this.mTables);
        qb.setDistinct(this.mDistinct);
        qb.query({
            database: this.mDatabase,
            projectionIn: this.mProjection,
            selection: this.mSelection,
            selectionArgs: this.mSelectionArgs,
            groupBy: this.mGroupBy,
            having: this.mHaving,
            sortOrder: this.mSortOrder,
            limit: this.mLimit,
            adapter: new SQLiteTransactionAdapter({
                begin : (session) => {},
                commit : (session, cursor) => {
                    cursor.getCount();
                    task.notify(cursor);
                },
                rollback : (session, error) => {
                    task.cancel();
                }
            })
        });
    }

    onCanceled(cursor=null) {
        if (cursor && !cursor.isClosed()) {
            cursor.close();
        }
    }

    onReset() {
        super.onReset();
        this.onStopLoading();
        if (this.mCursor && !this.mCursor.isClosed()) {
            this.mCursor.close();
        }
        this.mCursor = null;
    }

    onStartLoading() {
        if (this.mCursor) {
            this.deliverResult(this.mCursor);
        }
        if (this.takeContentChanged() || !this.mCursor) {
            this.forceLoad();
        }
    }

    onStopLoading() {
        this.cancelLoad();
    }
}