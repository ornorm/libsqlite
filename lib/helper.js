/** @babel */
import * as math from "hjs-core/lib/math";
import {Configuration} from "conflib/lib/conf";
import {SQLiteEvent} from "./event";
import {Cursor, CursorFactory} from "./cursor";
import {SQLiteDatabase} from "./sqlite";

export const BaseColumns = {
    _ID: "_id",
    _COUNT: "_count"
};

export const Hex = {

    arrayBufferToHex(buffer) {
        let byteArray = new Uint8Array(buffer);
        let hexParts = [];
        for (let i = 0; i < byteArray.length; i++) {
            let hex = byteArray[i].toString(16);
            let paddedHex = ('00' + hex).slice(-2);
            hexParts.push(paddedHex);
        }
        return hexParts.join('');
    },

    hexToArrayBuffer(hex) {
        if (typeof hex !== 'string') {
            throw new TypeError('Expected input to be a string')
        }
        if ((hex.length % 2) !== 0) {
            throw new RangeError('Expected string to be an even number of characters')
        }
        let view = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            view[i / 2] = parseInt(hex.substring(i, i + 2), 16)
        }
        return view.buffer;
    }

};

export class ColumnInfo {

    constructor(index, column) {
        this.cid = index;
        this.notnull = this.pk = this.unique = false;
        let fields = column.split(" ");
        if (fields) {
            let len = fields.length;
            let def = false;
            for (let i = 0; i < len; i++) {
                let field = fields[i];
                if (i === 0) {
                    this.name = field.trim();
                } else if (i === 1) {
                    this.type = field.trim();
                } else {
                    if (def) {
                        this.dflt_value = field.trim();
                        def = false;
                    }
                    if (field.indexOf("NOT NULL") !== -1 || field.indexOf("not null") !== -1) {
                        this.notnull = true;
                    }
                    if (field.indexOf("PRIMARY KEY") !== -1 || field.indexOf("primary key") !== -1) {
                        this.pk = true;
                    }
                    if (field.indexOf("DEFAULT") !== -1 || field.indexOf("default") !== -1) {
                        def = true;
                    }
                }
            }
        }
    }

    getCid() {
        return this.cid;
    }

    getDefaultValue() {
        return this.dflt_value;
    }

    getName() {
        return this.name;
    }

    getType() {
        return this.type;
    }

    isNotNull() {
        return this.notnull;
    }

    isPrimaryKey() {
        return this.pk;
    }

    isUnique() {
        return this.unique;
    }

    toString() {
        let str = "ColumnInfo[cid:"
            + (!this.cid ? -1 : this.cid)
            + ",\nname:" + this.name + ",\ntype:" + this.type
            + ",\nnotnull:" + this.notnull + ",\ndflt_value:"
            + (this.dflt_value || "") + ",\npk:" + this.pk
            + ",\nunique:" + this.unique + "]";
        return str;
    }

}

const TABLES = new Map();

export class TableInfo {

    constructor(tableName) {
        this.tableName = tableName;
        this.columnNames = [];
        this.columns = [];
    }

    getColumnInfo(index) {
        return this.columns[index];
    }

    getColumnInfoByName(name) {
        let len = this.columns.length;
        for (let j = 0; j < len; j++) {
            let column = this.columns[j];
            if (column.getName() === name) {
                return column;
            }
        }
        return null;
    }

    getColumnNames() {
        return this.columnNames;
    }

    static getTable(tableName) {
        return TABLES.get(tableName);
    }

    static getTables() {
        return TABLES.entries();
    }

    static getTableNames() {
        return TABLES.values();
    }

    getTableName() {
        return this.tableName;
    }

    parse(sql) {
        if (sql) {
            this.sql = sql;
            let idx1 = sql.indexOf("(");
            let idx2 = sql.indexOf(")");
            let definitions = sql.substring(idx1 + 1, idx2);
            let parts = definitions.split(",");
            let len = parts.length;
            let index = 0;
            for (let i = 0; i < len; i++) {
                let part = parts[i].trim();
                if (part.indexOf("UNIQUE") !== -1 || part.indexOf("unique") !== -1) {
                    idx1 = part.indexOf("(");
                    part = part.substring(idx1 + 1, part.length).trim();
                    for (let j = 0; j < this.columns.length; j++) {
                        let c = this.columns[j];
                        if (c.getName() === part) {
                            c.unique = true;
                            break;
                        }
                    }
                } else {
                    let column = new ColumnInfo(index, part);
                    this.columns.push(column);
                    this.columnNames.push(column.getName());
                    index++;
                }
            }
        }
    }

    static setTable(name, value) {
        if (!TABLES.has(name)) {
            TABLES.set(name, value);
        }
    }

    toString() {
        return "TableInfo[" + (this.sql || "") + "]";
    }

}


export class InsertHelper {

    constructor(db, tableName) {
        this.mDb = db;
        this.mTableName = tableName;
        this.mColumns = null;
        this.mPreparedStatement = null;
        this.mReplaceStatement = null;
        this.mInsertStatement = null;
        this.mInsertSQL = null;
        this.mDb = null;
    }

    bind(index = 0, value = null) {
        if (typeof value === "number") {
            if (math.isInt(value)) {
                this.mPreparedStatement.bindLong(index, value);
            } else {
                this.mPreparedStatement.bindDouble(index, value);
            }
        } else if (typeof value === "boolean") {
            this.mPreparedStatement.bindLong(index, value ? 1 : 0);
        } else if (value instanceof ArrayBuffer) {
            this.mPreparedStatement.bindBlob(index, value);
        } else if (typeof value === "string") {
            this.mPreparedStatement.bindString(index, value);
        } else {
            this.bindNull(index);
        }
    }

    bindNull(index) {
        this.mPreparedStatement.bindNull(index);
    }

    buildSQL() {
        let sb = "";
        sb += "INSERT INTO " + this.mTableName + " (";
        let sbv = "";
        sbv += "VALUES (";
        let table = TableInfo.getTable(this.mTableName);
        if (table) {
            let names = table.getColumnNames();
            let mColumns = {};
            let len = names.length;
            for (let i = 0; i < len; i++) {
                let columnName = names[i];
                let column = table.getColumnInfo(i);
                let defaultValue = column.getDefaultValue();
                mColumns[columnName] = i;
                sb += "'" + columnName + "'";
                if (!defaultValue) {
                    sbv += "?";
                } else {
                    sbv += "COALESCE(?, " + defaultValue + ")";
                }
                sb += i === (len - 1) ? ") " : ", ";
                sbv += i === (len - 1) ? ");" : ", ";
                ++i;
            }
            sb += sbv;
            this.mInsertSQL = sb;
            console.log("insert statement is " + this.mInsertSQL);
        }
    }

    close() {
        if (this.mInsertStatement) {
            this.mInsertStatement.close();
        }
        if (this.mReplaceStatement) {
            this.mReplaceStatement.close();
        }
        this.mInsertStatement = this.mReplaceStatement = null;
        this.mInsertSQL = this.mColumns = null;
    }

    execute(adapter) {
        if (!this.mPreparedStatement) {
            throw new ReferenceError("IllegalStateException you must prepare this inserter before calling "
                + "execute");
        }
        console.log("--- doing insert or replace in table " + this.mTableName);
        try {
            this.mPreparedStatement.executeInsert(adapter);
        } catch (e) {
            console.log("Error executing InsertHelper with table " + this.mTableName + "[" + e.message + "]");
        } finally {
            this.mPreparedStatement = null;
        }
    }

    getColumnIndex(key) {
        this.getStatement(false);
        let index = this.mColumns[key];
        if (index >= 0) {
            throw new SyntaxError("IllegalArgumentException column '" + key + "' is invalid");
        }
        return index;
    }

    getStatement(allowReplace = false) {
        if (allowReplace) {
            if (!this.mReplaceStatement) {
                if (!this.mInsertSQL) {
                    this.buildSQL();
                }
                let replaceSQL = "INSERT OR REPLACE" + this.mInsertSQL.substring(6);
                this.mReplaceStatement = this.mDb.compileStatement(replaceSQL);
            }
            return this.mReplaceStatement;
        } else {
            if (!this.mInsertStatement) {
                if (!this.mInsertSQL) {
                    this.buildSQL();
                }
                this.mInsertStatement = this.mDb.compileStatement(this.mInsertSQL);
            }
            return this.mInsertStatement;
        }
    }

    insert(values, adapter = null) {
        return this.insertInternal(values, false, adapter);
    }

    insertInternal(values, allowReplace = false, adapter = null) {
        try {
            let stmt = this.getStatement(allowReplace);
            stmt.clearBindings();
            console.log("--- inserting in table " + this.mTableName);
            let i = -1;
            for (let key in values) {
                if (values.hasOwnProperty(key)) {
                    i = this.getColumnIndex(key);
                    DatabaseUtils.bindObjectToProgram(stmt, i, values[key]);
                    console.log("binding " + values[key] + " to column " + i + " (" + key + ")");
                }
            }
            stmt.executeInsert(adapter);
        } catch (e) {
            console.log("Error inserting " + values + " into table  " + this.mTableName + "[" + e.message + "]");
        }
    }

    prepareForInsert() {
        this.mPreparedStatement = this.getStatement(false);
        this.mPreparedStatement.clearBindings();
    }

    prepareForReplace() {
        this.mPreparedStatement = this.getStatement(true);
        this.mPreparedStatement.clearBindings();
    }

    replace(values, adapter = null) {
        return this.insertInternal(values, true, adapter);
    }

}
InsertHelper.TABLE_INFO_PRAGMA_COLUMNNAME_INDEX = 1;
InsertHelper.TABLE_INFO_PRAGMA_DEFAULT_INDEX = 4;

export const DatabaseUtils = {
    DELETE: "DELETE",
    INSERT: "INSERT",
    SELECT: "SELECT",
    UPDATE: "UPDATE",
    STATEMENT_SELECT: 1,
    STATEMENT_UPDATE: 2,
    STATEMENT_ATTACH: 3,
    STATEMENT_BEGIN: 4,
    STATEMENT_COMMIT: 5,
    STATEMENT_ABORT: 6,
    STATEMENT_PRAGMA: 7,
    STATEMENT_DDL: 8,
    STATEMENT_UNPREPARED: 9,
    STATEMENT_OTHER: 99,
    appendEscapedSQLString(sb = "", sqlString = "") {
        sb += '\'';
        if (sqlString.indexOf('\'') !== -1) {
            let length = sqlString.length, c;
            for (let i = 0; i < length; i++) {
                c = sqlString.charAt(i);
                if (c === '\'') {
                    sb += '\'';
                }
                sb += c;
            }
        } else {
            sb += sqlString;
        }
        return sb += '\'';
    },
    appendSelectionArgs(originalValues = [], newValues = []) {
        if (!originalValues || originalValues.length === 0) {
            return newValues;
        }
        let result = [];
        result.concat(originalValues).concat(newValues);
        return result;
    },
    appendValueToSql(sql, value = null) {
        if (!value) {
            sql += "NULL";
        } else if (typeof value === "boolean") {
            sql += value ? "1" : "0";
        } else if (typeof value === "number") {
            sql += "" + value;
        } else if (value instanceof ArrayBuffer) {
            sql += this.toBlob(value);
        } else {
            sql = this.appendEscapedSQLString(sql, value);
        }
        return sql;
    },
    bindArgsToArrayString(bindArgs = []) {
        let value = null;
        let len = bindArgs.length;
        let results = new Array(bindArgs.length);
        while (len--) {
            value = bindArgs[len];
            if (!value) {
                results[len] = "NULL";
            } else if (typeof value === "boolean") {
                results[len] = value ? "1" : "0";
            } else if (typeof value === "number") {
                results[len] = "" + value;
            } else if (value instanceof ArrayBuffer) {
                results[len] = this.toBlob(value);
            } else {
                results[len] = value;
            }
        }
        return results;
    },
    bindObjectToProgram(prog, index = 0, value = null) {
        if (value === null) {
            prog.bindNull(index);
        } else if (typeof value === "number") {
            if (math.isInt(value)) {
                prog.bindDouble(index, value);
            } else {
                prog.bindLong(index, value);
            }
        } else if (typeof value === "boolean") {
            prog.bindLong(index, value ? 1 : 0);
        } else if (value instanceof ArrayBuffer) {
            prog.bindBlob(index, value);
        } else {
            prog.bindString(index, value);
        }
    },
    concatenateWhere(a = [], b = []) {
        if (a.length === 0) {
            return b;
        }
        if (b.length === 0) {
            return a;
        }
        return "(" + a + ") AND (" + b + ")";
    },
    countValues(values) {
        let index = 0;
        for (let p in values) {
            if (values.hasOwnProperty(p)) {
                index++;
            }
        }
        return index;
    },
    cursorDoubleToContentValues(cursor, values = {}, column = "", key = null) {
        key = key || column;
        let colIndex = cursor.getColumnIndex(column);
        if (!cursor.isNull(colIndex)) {
            values[key] = cursor.getDouble(colIndex);
        } else {
            values[key] = null;
        }
    },
    cursorDoubleToContentValuesIfPresent(cursor, values = {}, column = "") {
        let index = cursor.getColumnIndex(column);
        if (index !== -1 && !cursor.isNull(index)) {
            values[column] = cursor.getDouble(index);
        }
    },
    cursorFloatToContentValuesIfPresent(cursor, values = {}, column = "") {
        let index = cursor.getColumnIndex(column);
        if (index !== -1 && !cursor.isNull(index)) {
            values[column] = cursor.getFloat(index);
        }
    },
    cursorIntToContentValues(cursor, values = {}, column = "", key = null) {
        key = key || column;
        let colIndex = cursor.getColumnIndex(column);
        if (!cursor.isNull(colIndex)) {
            values[key] = cursor.getInt(colIndex);
        } else {
            values[key] = null;
        }
    },
    cursorIntToContentValuesIfPresent(cursor, values = {}, column = "") {
        let index = cursor.getColumnIndex(column);
        if (index !== -1 && !cursor.isNull(index)) {
            values[column] = cursor.getInt(index);
        }
    },
    cursorLongToContentValues(cursor, values = {}, column = "", key = null) {
        key = key || column;
        let colIndex = cursor.getColumnIndex(column);
        if (!cursor.isNull(colIndex)) {
            values[key] = cursor.getLong(colIndex);
        } else {
            values[key] = null;
        }
    },
    cursorLongToContentValuesIfPresent(cursor, values = {}, column = "") {
        let index = cursor.getColumnIndex(column);
        if (index !== -1 && !cursor.isNull(index)) {
            values[column] = cursor.getLong(index);
        }
    },
    cursorRowToContentValues(cursor, values = {}) {
        let columns = cursor.getColumnNames();
        let length = columns.length;
        for (let i = 0; i < length; i++) {
            if (cursor.isBlob(i)) {
                values[columns[i]] = cursor.getBlob(i);
            } else {
                values[columns[i]] = cursor.getString(i);
            }
        }
    },
    cursorShortToContentValuesIfPresent(cursor, values = {}, column = "") {
        let index = cursor.getColumnIndex(column);
        if (index !== -1 && !cursor.isNull(index)) {
            values[column] = cursor.getShort(index);
        }
    },
    cursorStringToContentValues(cursor, values = {}, column = "", key = null) {
        values[key || column] = cursor.getString(cursor.getColumnIndexOrThrow(column));
    },
    cursorStringToInsertHelper(cursor, inserter, column = "", index = 0) {
        inserter.bind(index, cursor.getString(cursor.getColumnIndexOrThrow(column)));
    },
    dumpCursor(cursor) {
        console.log(">>>>> Dumping cursor " + cursor);
        if (cursor) {
            let startPos = cursor.getPosition();
            cursor.moveToPosition(-1);
            while (cursor.moveToNext()) {
                this.dumpCurrentRow(cursor);
            }
            cursor.moveToPosition(startPos);
        }
        console.log("<<<<<");
    },
    dumpCurrentRow(cursor) {
        let cols = cursor.getColumnNames();
        console.log("" + cursor.getPosition() + " {");
        let length = cols.length, value;
        for (let i = 0; i < length; i++) {
            try {
                value = cursor.getString(i);
            } catch (e) {
                value = "<unprintable>";
            }
            console.log("   " + cols[i] + '=' + value);
        }
        console.log("}");
    },
    findEditTable(tables = []) {
        if (tables && tables.length > 0) {
            let spacepos = tables.indexOf(' ');
            let commapos = tables.indexOf(',');
            if (spacepos > 0 && (spacepos < commapos || commapos < 0)) {
                return tables.substring(0, spacepos);
            } else if (commapos > 0
                && (commapos < spacepos || spacepos < 0)) {
                return tables.substring(0, commapos);
            }
            return tables;
        } else {
            throw new SyntaxError("IllegalStateException Invalid tables");
        }
    },
    findRowIdColumnIndex(columnNames) {
        let length = columnNames.length;
        for (let i = 0; i < length; i++) {
            if (columnNames[i] === BaseColumns._ID) {
                return i;
            }
        }
        return -1;
    },
    getSqlStatementType(sql) {
        sql = sql.trim();
        if (sql.length < 3) {
            return this.STATEMENT_OTHER;
        }
        let prefixSql = sql.substring(0, 3).toUpperCase();
        if (prefixSql === "SEL") {
            return this.STATEMENT_SELECT;
        } else if (prefixSql === "INS" || prefixSql === "UPD"
            || prefixSql === "REP"
            || prefixSql === "DEL") {
            return this.STATEMENT_UPDATE;
        } else if (prefixSql === "ATT") {
            return this.STATEMENT_ATTACH;
        } else if (prefixSql === "COM") {
            return this.STATEMENT_COMMIT;
        } else if (prefixSql === "END") {
            return this.STATEMENT_COMMIT;
        } else if (prefixSql === "ROL") {
            return this.STATEMENT_ABORT;
        } else if (prefixSql === "BEG") {
            return this.STATEMENT_BEGIN;
        } else if (prefixSql === "PRA") {
            return this.STATEMENT_PRAGMA;
        } else if (prefixSql === "CRE" || prefixSql === "DRO" || prefixSql === "ALT") {
            return this.STATEMENT_DDL;
        } else if (prefixSql === "ANA" || prefixSql === "DET") {
            return this.STATEMENT_UNPREPARED;
        }
        return this.STATEMENT_OTHER;
    },
    getTypeOfObject(obj) {
        if (typeof obj === "string") {
            if (obj.indexOf("X'") === 0) {
                return Cursor.FIELD_TYPE_BLOB;
            }
            return Cursor.FIELD_TYPE_STRING;
        } else if (!isNaN(obj)) {
            if (math.isInt(obj)) {
                return Cursor.FIELD_TYPE_INTEGER;
            }
            return Cursor.FIELD_TYPE_FLOAT;
        } else {
            return Cursor.FIELD_TYPE_NULL;
        }
    },
    longForQuery({db, prog = null, query = "", adapter = null, selectionArgs = []} = {}) {
        if (db && query) {
            prog = db.compileStatement(query);
            this.longForQuery({prog, selectionArgs, adapter});
        } else {
            prog.bindAllArgsAsStrings(selectionArgs);
            prog.simpleQueryForLong(adapter);
        }
    },
    queryIsEmpty({db, table = "", adapter = null} = {}) {
        if (db && table) {
            let query = "SELECT EXISTS(SELECT 1 FROM " + table + ")";
            this.longForQuery({db, query, adapter});
        }
    },
    queryNumEntries({db, table, selection = null, selectionArgs = []} = {}) {
        let s = selection && selection.length > 0 ? " WHERE " + selection : "";
        let query = "SELECT COUNT(*) FROM " + table + s;
        this.longForQuery({db, query, selectionArgs});
    },
    sqlEscapeString(value) {
        return this.appendEscapedSQLString("", value);
    },
    stringForQuery({db = null, prog = null, query = null, adapter = null, selectionArgs = []} = {}) {
        if (db && query) {
            prog = db.compileStatement(query);
            this.stringForQuery({
                prog,
                selectionArgs,
                adapter
            });
        } else {
            prog.bindAllArgsAsStrings(selectionArgs);
            prog.simpleQueryForString(adapter);
        }
    },
    toBlob(buffer) {
        return "X'" + Hex.arrayBufferToHex(buffer) + "'";
    }
};

export class SQLiteOpenHelper extends CursorFactory {

    constructor({
                    version = 0,
                    newCursor = null,
                    onChange = null,
                    onConfigure = null,
                    onCreate = null,
                    onExecute = null,
                    onDowngrade = null,
                    onUpgrade = null,
                    onError = null,
                    onHandleEvent = null,
                    onOpen = null,
                    onTransaction = null
                } = {}) {
        super({onHandleEvent, newCursor});
        if (onChange) {
            this.onChange = onChange;
        }
        if (onConfigure) {
            this.onConfigure = onConfigure;
        }
        if (onCreate) {
            this.onCreate = onCreate;
        }
        if (onExecute) {
            this.onExecute = onExecute;
        }
        if (onDowngrade) {
            this.onDowngrade = onDowngrade;
        }
        if (onUpgrade) {
            this.onUpgrade = onUpgrade;
        }
        if (onError) {
            this.onError = onError;
        }
        if (onOpen) {
            this.onOpen = onOpen;
        }
        if (onTransaction) {
            this.onTransaction = onTransaction;
        }
        if (version && version < 1) {
            throw new RangeError("IllegalArgumentException Version must be > 1, was " + version);
        }
        this.mDatabase = null;
        this.mNewVersion = version;
        this.mIsInitializing = false;
    }

    close() {
        if (this.mIsInitializing) {
            throw new Error("IllegalStateException Closed during initialization");
        }
        if (this.mDatabase) {
            this.mDatabase.close();
            this.mDatabase = null;
        }
    }

    getDatabaseLocked(writable = false) {
        if (this.mDatabase) {
            if (!this.mDatabase.isOpen()) {
                this.mDatabase = null;
            } else if (!writable || !this.mDatabase.isReadOnly()) {
                return this.mDatabase;
            }
        }
        if (this.mIsInitializing) {
            throw new Error("IllegalStateException getDatabase called recursively");
        }
        let db = this.mDatabase;
        if (db) {
            if (writable && db.isReadOnly()) {
                db.reopenReadWrite();
            }
        } else {
            try {
                if (!writable) {
                    db = this.openReadOnly();
                } else {
                    db = SQLiteDatabase.openOrCreateDatabase({factory: this});
                }
            } catch (e) {
                this.mIsInitializing = false;
                if (writable) {
                    throw e;
                }
                console.log("Couldn't open database for writing (will try read-only):" + e.message);
                db = this.openReadOnly();
            }
        }
        return db;
    }

    getDatabaseName() {
        if (this.mDatabase) {
            return this.mDatabase.getName();
        }
        return null;
    }

    getLabel() {
        if (this.mDatabase) {
            return this.mDatabase.getLabel();
        }
        return null;
    }

    getReadableDatabase() {
        return this.getDatabaseLocked(false);
    }

    getWritableDatabase() {
        return this.getDatabaseLocked(true);
    }

    notifyClosed() {
        this.mDatabase.notifyListeners(new SQLiteEvent({
            source: this.mDatabase,
            id: SQLiteEvent.CLOSE
        }));
    }

    notifyOpened() {
        this.mDatabase.notifyListeners(new SQLiteEvent({
            source: this.mDatabase,
            id: SQLiteEvent.OPEN
        }));
    }

    onChange(database, resultSet) {
    }

    onConfigure(database) {
    }

    onCreate(database) {
    }

    onDowngrade(database, oldVersion = 0, newVersion = 1) {
        throw new RangeError("SQLiteException Can't downgrade database from version " +
            oldVersion + " to " + newVersion);
    }

    onError(database, error) {
    }

    onExecute(database, data) {
    }

    onHandleEvent(evt) {
        let id = evt.getId();
        let source = evt.getSource();
        let data = evt.getData();
        if (this.mIsInitializing) {
            this.mDatabase = source;
            switch (id) {
                case SQLiteEvent.CREATE:
                    this.onConfigure(this.mDatabase);
                    let version = this.mDatabase.getVersion();
                    if (version !== this.mNewVersion) {
                        if (this.mDatabase.isReadOnly()) {
                            throw new RangeError(
                                "SQLiteException Can't upgrade read-only database from version " +
                                this.mDatabase.getVersion() + " to " +
                                this.mNewVersion + ": " +
                                this.mDatabase.getName());
                        }
                        if (!this.mNewVersion) {
                            this.mNewVersion = version;
                        }
                        if (this.mNewVersion === 1.0 ||
                            this.mNewVersion === version) {
                            this.onCreate(this.mDatabase);
                            this.notifyOpened();
                        } else {
                            Configuration.getInstance().setProperty("db.version", this.mNewVersion);
                            this.mDatabase.setVersion(this.mNewVersion, (result) => {
                                if (result > -1) {
                                    if (version > this.mNewVersion) {
                                        this.onDowngrade(this.mDatabase, version, this.mNewVersion);
                                    } else {
                                        this.onUpgrade(this.mDatabase, version, this.mNewVersion);
                                    }
                                    this.notifyOpened();
                                } else {
                                    this.notifyClosed();
                                }
                            });
                        }
                    } else {
                        this.notifyOpened();
                    }
                    break;
                case SQLiteEvent.ROLLBACK:
                case SQLiteEvent.ERROR:
                    console.log(data);
                    this.onError(source.getDatabase(), data);
                    this.notifyClosed();
                    break;
                case SQLiteEvent.OPEN:
                    this.mIsInitializing = false;
                    this.onOpen(this.mDatabase);
                    if (this.mDatabase.isReadOnly()) {
                        console.log("Opened " + this.mDatabase.getName() + " in read-only mode");
                    }
                    break;
            }
        } else {
            switch (id) {
                case SQLiteEvent.CHANGE:
                    this.onChange(source, data);
                    break;
                case SQLiteEvent.BEGIN:
                case SQLiteEvent.COMMIT:
                case SQLiteEvent.ROLLBACK:
                    this.onTransaction(source, data);
                    break;
                case SQLiteEvent.EXECUTE:
                    this.onExecute(source, data);
                    break;
                case SQLiteEvent.ERROR:
                    this.onError(source, data);
                    break;
            }
        }
    }

    onOpen(database) {
    }

    onUpgrade(database, oldVersion, newVersion) {
    }

    onTransaction(transaction, resultSet) {
    }

    openReadOnly() {
        return null;
    }
}
