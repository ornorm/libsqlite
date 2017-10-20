/** @babel */
import {LinkedList} from "hjs-collection/lib/list";
import {AbstractQueue, Queue} from "hjs-collection/lib/queue";
import {SQLiteEvent, SQLiteTransactionListener} from "./event";
import {DatabaseUtils} from "./helper";

export class SQLiteTransactionAdapter extends SQLiteTransactionListener {

    constructor({onBegin=null, onCommit=null, onRollback=null,table=null,catchError=false}) {
        super({onBegin,onCommit,onRollback});
        this.mTable = table;
        this.catchError = catchError;
    }

    canCatchError() {
        return this.catchError;
    }

    getTable() {
        return this.mTable;
    }

    setCatchError(catchError) {
        this.catchError = catchError;
    }

    setTable(table) {
        this.mTable = table;
    }

}

export class Transaction {

    constructor() {
        this.mId = 0;
        this.mMode = 0;
        this.mParent = null;
        this.mListener = null;
        this.mStatement = null;
        this.mChildFailed = false;
        this.mMarkedSuccessful = false;
    }

    getId() {
        return this.mId;
    }

    getListener() {
        return this.mListener;
    }

    getMode() {
        return this.mMode;
    }

    getParent() {
        return this.mParent;
    }

    getStatement() {
        return this.mStatement;
    }

    isChildFailed() {
        return this.mChildFailed;
    }

    isMarkedSuccessful() {
        return this.mMarkedSuccessful;
    }

    toString() {
        let str = "";
        str += "Transaction[id:" + this.mId + ",\n statement:"
            + this.mStatement + ",\n successful:"
            + this.mMarkedSuccessful + ",\n childFailed:"
            + this.mChildFailed + "]";
        return str;
    }

}

export class SQLiteSession {

    constructor(connection) {
        if (!connection) {
            throw new ReferenceError("IllegalArgumentException connection must not be null");
        }
        this.mConnection = connection;
        this.mNumTransaction = 0;
    }

    beginTransaction(sql="", bindArgs=[], listener=null) {
        this.mConnection.transaction((tx) => {
            this.mNumTransaction = SQLiteSession.TRANSACTION_COUNT++;
            try {
                if (listener) {
                    listener.onBegin(this);
                }
                tx.executeSql(
                    sql,
                    bindArgs,
                    (transaction, resultSet) => { this.setTransactionSuccessful(transaction, resultSet); },
                    (transaction, result) => { this.endTransaction(transaction, result); }
                    );
                let transaction = this.obtainTransaction(listener);
                transaction.mId = this.mNumTransaction;
                transaction.mStatement = sql;
                transaction.mParent = this.mTransactionStack;
                this.mTransactionStack = transaction;
            } catch (e) {
                if (this.mTransactionStack) {
                    this.mTransactionStack = null;
                }
                this.mConnection.notifyListeners(new SQLiteEvent({
                    source : this.mConnection,
                    id : SQLiteEvent.ERROR,
                    data : e
                }));
            }
        });
    }

    endTransaction(transaction, result) {
        this.throwIfNoTransaction();
        this.endTransactionUnchecked(result);
    }

    endTransactionUnchecked(result) {
        let top = this.mTransactionStack;
        let successful = top.mMarkedSuccessful && !top.mChildFailed;
        let listener = top.mListener;
        let listenerException = null;
        if (listener) {
            try {
                if (successful) {
                    listener.onCommit(this, result);
                } else {
                    listener.onRollback(this, result);
                }
            } catch (e) {
                listenerException = e;
                successful = false;
            }
        }
        this.mTransactionStack = top.mParent;
        this.recycleTransaction(top);
        if (this.mTransactionStack) {
            if (!successful) {
                this.mTransactionStack.mChildFailed = true;
            }
        } else {
            /*
             console.log("NOT CATCH CASE");
             this.mConnection
             .notifyListeners(new SQLiteEvent(
             {
             source : this.mConnection,
             id : successful ? SQLiteEvent.CHANGE
             : SQLiteEvent.ERROR,
             data : result
             }));
             */
        }
        if (listenerException) {
            throw listenerException;
        }
    }

    executeSpecial({transaction,sql="",bindArgs=[],listener=null,resultSet={}}={}) {
        let type = DatabaseUtils.getSqlStatementType(sql);
        switch (type) {
            case DatabaseUtils.STATEMENT_BEGIN:
                this.beginTransaction(sql, bindArgs, listener);
                return true;
            case DatabaseUtils.STATEMENT_COMMIT:
                this.setTransactionSuccessful(transaction, resultSet);
                return true;
            case DatabaseUtils.STATEMENT_ABORT:
                this.endTransaction(transaction, resultSet);
                return true;
        }
        return false;
    }

    getNumTransaction() {
        return this.mNumTransaction;
    }

    hasConnection() {
        return this.mConnection !== null && this.mConnection !== undefined;
    }

    hasNestedTransaction() {
        return this.mTransactionStack && this.mTransactionStack.mParent;
    }

    hasTransaction() {
        return this.mTransactionStack !== null && this.mTransactionStack !== undefined;
    }

    obtainTransaction(listener=null) {
        let transaction = this.mTransactionPool;
        if (transaction) {
            this.mTransactionPool = transaction.mParent;
            transaction.mParent = null;
            transaction.mMarkedSuccessful = false;
            transaction.mChildFailed = false;
        } else {
            transaction = new Transaction();
        }
        transaction.mListener = listener;
        return transaction;
    }

    recycleTransaction(transaction=null) {
        transaction.mParent = this.mTransactionPool;
        transaction.mListener = null;
        this.mTransactionPool = transaction;
    }

    setTransactionSuccessful(transaction, resultSet={}) {
        this.throwIfNoTransaction();
        this.throwIfTransactionMarkedSuccessful();
        this.mTransactionStack.mMarkedSuccessful = true;
        this.endTransaction(transaction, resultSet);
    }

    throwIfNestedTransaction() {
        if (this.hasNestedTransaction()) {
            throw new ReferenceError(
                "IllegalStateException Cannot perform this operation because "
                + "a nested transaction is in progress.");
        }
    }

    throwIfNoTransaction() {
        if (!this.mTransactionStack) {
            throw new ReferenceError(
                "IllegalStateException Cannot perform this operation because "
                + "there is no current transaction.");
        }
    }

    throwIfTransactionMarkedSuccessful() {
        if (this.mTransactionStack && this.mTransactionStack.mMarkedSuccessful) {
            throw new ReferenceError(
                "IllegalStateException Cannot perform this operation because "
                + "the transaction has already been marked successful.  The only "
                + "thing you can do now is call endTransaction().");
        }
    }

}

SQLiteSession.TRANSACTION_COUNT = 0;

export class SQLiteTransactionQueue extends AbstractQueue {

    constructor({database,complete=null}={}) {
        super();
        if (!database) {
            throw new ReferenceError("NullPointerException database object is null");
        }
        this.mDatabase = database;
        if (complete) {
            this.mComplete = complete;
        }
        this.mQueue = null;
        this.mTransactions = [];
    }

    add(e) {
        return this.offer(e);
    }

    addAll(c) {
        let len = c.length;
        for (let i=0; i<len; i++) {
            if (!this.add(c[i])) {
                return false;
            }
        }
        return true;
    }

    begin() {
        let len = this.mTransactions.length;
        if (this.mQueue) {
            this.mQueue.clear();
        }
        this.mQueue = new Queue(len);
        if (this.mQueue.addAll(this.mTransactions) && this.next()) {
            this.mTransactions = [];
        }
    }

    clear() {
        if (!this.mQueue) {
            this.mTransactions = [];
        } else {
            this.mQueue.clear();
        }
    }

    contains(e) {
        if (!this.mQueue) {
            return this.mTransactions.indexOf(item) !== -1;
        }
        return this.mQueue.contains(e);
    }

    containsAll(c) {
        if (!this.mQueue) {
            let len = c.length;
            while (len--) {
                let item = c[len];
                if (this.mTransactions.indexOf(item) === -1) {
                    return false;
                }
            }
            return true;
        }
        return this.mQueue.containsAll(c);
    }

    element() {
        return this.peek();
    }

    getDatabase() {
        return this.mDatabase;
    }

    isEmpty() {
        if (this.mQueue) {
            return this.mQueue.isEmpty();
        }
        return this.mTransactions.length === 0;
    }

    next() {
        let statement = this.poll();
        if (statement) {
            this.mDatabase.beginTransaction(
                statement.statement,
                statement.bindArgs,
                new SQLiteTransactionListener({
                    onBegin : (session) => {
                        this.mDatabase.notifyListeners(new SQLiteEvent({
                            source : this,
                            id : SQLiteEvent.BEGIN
                        }));
                    },
                    onCommit : (session, resultSet) => {
                        this.mDatabase.notifyListeners(new SQLiteEvent({
                            source : this,
                            id : SQLiteEvent.COMMIT,
                            data : resultSet
                        }));
                        if (!this.next() && this.mComplete) {
                            this.mComplete(this);
                        }
                    },
                    onRollback : (session, error) => {
                        this.mDatabase.notifyListeners(new SQLiteEvent({
                            source : this,
                            id : SQLiteEvent.ROLLBACK,
                            data : error
                        }));
                    }
                }));
            return true;
        }
        return false;
    }

    offer(transaction) {
        if (!this.mQueue) {
            let oldLength = this.mTransactions.length;
            return this.mTransactions.push(transaction) > oldLength;
        }
        return false;
    }

    peek() {
        if (this.mQueue) {
            return this.mQueue.peek();
        }
        return this.mTransactions[0];
    }

    poll() {
        if (this.mQueue) {
            return this.mQueue.poll();
        }
        return null;
    }

    remove() {
        if (this.mQueue) {
            return this.mTransactions.pop();
        }
        return null;
    }

    size() {
        return this.mTransactions.length;
    }
}

export class SQLiteQueueItem {

    constructor({name="",index=1,command="",parameters={}}) {
        this.mIndex = index;
        this.mCommand = command;
        this.mParameters = parameters;
        if (this.mParameters && this.mParameters.hasOwnProperty("name")) {
            this.mName = this.mParameters.name;
            delete this.mParameters.name;
        }
    }

    getCommand() {
        return this.mCommand;
    }

    getIndex() {
        return this.mIndex;
    }

    getName() {
        return this.mName;
    }

    getParameters() {
        return this.mParameters;
    }
}

export class SQLiteQueue extends AbstractQueue {

    constructor(name, database) {
        super();
        this.mName = name;
        this.mDatabase = database;
        this.mQueue = new LinkedList();
    }

    add(e) {
        return this.mQueue.add(e);
    }

    addAll(c) {
        return this.mQueue.addAll(c);
    }

    clear() {
        this.mQueue.clear();
    }

    contains(e) {
        return this.mQueue.contains(e);
    }

    containsAll(c) {
        return this.mQueue.containsAll(c);
    }

    DELETE({editTable="",query="",bindArgs=[],catchError=false,adapter=null}={}) {
        this.offer(new SQLiteQueueItem({
            command: "DELETE",
            parameters: {editTable,query,bindArgs,catchError,adapter},
            index: this.mQueue.size()
        }));
    }

    DROP({table="",adapter=null}={}) {
        this.offer(new SQLiteQueueItem({
            command: "DROP",
            parameters: {table,adapter},
            index: this.mQueue.size()
        }));
    }

    EXEC({sql="", bindArgs=[], adapter=null}={}) {
        this.offer(new SQLiteQueueItem({
            command: "EXEC",
            parameters: {sql,bindArgs,adapter},
            index: this.mQueue.size()
        }));
    }

    element() {
        return this.mQueue.element();
    }

    execute(listener=null) {
        let item = this.mQueue.poll();
        let canExecute = item !== null && item !== undefined;
        if (canExecute) {
            const name = item.getName();
            const index = item.getIndex();
            const command = item.getCommand();
            const parameters = item.getParameters();
            const hasListener = listener !== null && listener !== undefined;
            let adapter = new SQLiteTransactionAdapter({
                begin : (session) => {
                    let evt = new SQLiteEvent({
                        source: queue,
                        id : SQLiteEvent.BEGIN, data : { session, name, index, command }
                    });
                    if (hasListener) {
                        listener.handleExecution(evt);
                    } else {
                        this.mDatabase.notifyListeners(evt);
                    }
                },
                commit : (session, cursor) => {
                    let id = this.execute(listener) ? SQLiteEvent.COMMIT : SQLiteEvent.READY;
                    let evt = new SQLiteEvent({
                        source: this,
                        id, data : { session, name, index, command, cursor }
                    });
                    if (hasListener) {
                        listener.handleExecution(evt);
                    } else {
                        this.mDatabase.notifyListeners(evt);
                    }
                },
                rollback : (session, error) => {
                    let id = this.execute(listener) ? SQLiteEvent.ROLLBACK : SQLiteEvent.READY;
                    let evt = new SQLiteEvent({
                        source: this,
                        id, data : { session, name, index, command, error }
                    });
                    if (hasListener) {
                        listener.handleExecution(evt);
                    } else {
                        this.mDatabase.notifyListeners(evt);
                    }
                }
            });
            adapter.setCatchError(true);
            parameters.adapter = adapter;
            switch(command) {
                case "DELETE":
                    this.mDatabase.deleteQuery(parameters);
                    break;
                case "DROP":
                    this.mDatabase.dropTable(parameters);
                    break;
                case "INSERT":
                    this.mDatabase.insertQuery(parameters);
                    break;
                case "REPLACE":
                    this.mDatabase.replaceQuery(parameters);
                    break;
                case "UPDATE":
                    this.mDatabase.updateQuery(parameters);
                    break;
                case "EXEC":
                    this.mDatabase.execSQL(parameters.sql, parameters.bindArgs, parameters.adapter);
                    break;
            }
        }
        return canExecute;
    }

    getName() {
        return this.mName;
    }

    INSERT({editTable="",nullColumnHack="",initialValues={},adapter=null}={}) {
        this.offer(new SQLiteQueueItem({
            command: "INSERT",
            parameters: {editTable,nullColumnHack,initialValues,adapter},
            index: this.mQueue.size()
        }));
    }

    isEmpty() {
        return this.mQueue.isEmpty();
    }

    offer(e) {
        return this.mQueue.offer(e);
    }

    peek() {
        return this.mQueue.peek();
    }

    poll() {
        return this.mQueue.poll();
    }

    remove() {
        return this.mQueue.remove();
    }

    REPLACE({editTable="",nullColumnHack="",initialValues={},adapter=null}={}) {
        this.offer(new SQLiteQueueItem({
            command: "REPLACE",
            parameters: {editTable,nullColumnHack,initialValues,adapter},
            index: this.mQueue.size()
        }));
    }

    size() {
        return this.mQueue.size();
    }

    UPDATE({editTable="",query="",values={},bindArgs=[],adapter=null}={}) {
        this.offer(new SQLiteQueueItem({
            command: "UPDATE",
            parameters: {editTable,query,values,bindArgs,adapter},
            index: this.mQueue.size()
        }));
    }

}