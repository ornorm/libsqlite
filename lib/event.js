/** @babel */
import {ANY_EVENT, EventListener, EventObject} from "eventslib/lib/event";

export class SQLiteEvent extends EventObject {

    constructor({source, id = 703, priority = 0, data = null, when = Date.now()} = {}) {
        super({source, id, priority, data, when});
        if (this.id === ANY_EVENT) {
            this.id = SQLiteEvent.READY;
        }
    }

    consume() {
        switch (this.id) {
            case SQLiteEvent.EXECUTE:
            case SQLiteEvent.PROGRAM:
            case SQLiteEvent.READY:
            case SQLiteEvent.CREATE:
            case SQLiteEvent.CONFIGURE:
            case SQLiteEvent.UPGRADE:
            case SQLiteEvent.DOWNGRADE:
            case SQLiteEvent.OPEN:
            case SQLiteEvent.CLOSE:
            case SQLiteEvent.ERROR:
            case SQLiteEvent.CHANGE:
            case SQLiteEvent.BEGIN:
            case SQLiteEvent.COMMIT:
            case SQLiteEvent.ROLLBACK:
                this.consumed = true;
                break;
            default:
                this.consumed = false;
                break;
        }
    }

    paramString() {
        let typeStr = '';
        switch (this.id) {
            case SQLiteEvent.EXECUTE:
                typeStr = "EXECUTE";
                break;
            case SQLiteEvent.PROGRAM:
                typeStr = "PROGRAM";
                break;
            case SQLiteEvent.READY:
                typeStr = "READY";
                break;
            case SQLiteEvent.CREATE:
                typeStr = "CREATE";
                break;
            case SQLiteEvent.CONFIGURE:
                typeStr = "CONFIGURE";
                break;
            case SQLiteEvent.UPGRADE:
                typeStr = "UPGRADE";
                break;
            case SQLiteEvent.DOWNGRADE:
                typeStr = "DOWNGRADE";
                break;
            case SQLiteEvent.OPEN:
                typeStr = "OPEN";
                break;
            case SQLiteEvent.CLOSE:
                typeStr = "CLOSE";
                break;
            case SQLiteEvent.ERROR:
                typeStr = "ERROR";
                break;
            case SQLiteEvent.CHANGE:
                typeStr = "CHANGE";
                break;
            case SQLiteEvent.BEGIN:
                typeStr = "BEGIN";
                break;
            case SQLiteEvent.COMMIT:
                typeStr = "COMMIT";
                break;
            case SQLiteEvent.ROLLBACK:
                typeStr = "ROLLBACK";
                break;
            default:
                typeStr = "unknown type";
        }
        return `
            ${typeStr},
            when=${this.when},
            cmd=${this.data},
            priority=${this.priority},
            posted=${this.posted},
            consumed=${this.consumed}
            `;
    }

}

SQLiteEvent.FIRST = 700;
SQLiteEvent.EXECUTE = SQLiteEvent.FIRST + 1;
SQLiteEvent.PROGRAM = SQLiteEvent.FIRST + 2;
SQLiteEvent.READY = SQLiteEvent.FIRST + 3;
SQLiteEvent.CREATE = SQLiteEvent.FIRST + 4;
SQLiteEvent.CONFIGURE = SQLiteEvent.FIRST + 5;
SQLiteEvent.UPGRADE = SQLiteEvent.FIRST + 6;
SQLiteEvent.DOWNGRADE = SQLiteEvent.FIRST + 7;
SQLiteEvent.OPEN = SQLiteEvent.FIRST + 8;
SQLiteEvent.CLOSE = SQLiteEvent.FIRST + 9;
SQLiteEvent.ERROR = SQLiteEvent.FIRST + 10;
SQLiteEvent.CHANGE = SQLiteEvent.FIRST + 11;
SQLiteEvent.BEGIN = SQLiteEvent.FIRST + 12;
SQLiteEvent.COMMIT = SQLiteEvent.FIRST + 13;
SQLiteEvent.ROLLBACK = SQLiteEvent.FIRST + 14;
SQLiteEvent.LAST = 713;

export class SQLiteListener extends EventListener {

    constructor({ onHandleEvent=null }={}) {
        super();
        if (onHandleEvent) {
            this.onHandleEvent = onHandleEvent;
        }
    }

    onHandleEvent(evt) {
    }

}

export class SQLiteTransactionListener extends EventListener {

    constructor({onBegin = null, onCommit = null, onRollback = null }={}) {
        super();
        if (onBegin) {
            this.onBegin = onBegin;
        }
        if (onCommit) {
            this.onCommit = onCommit;
        }
        if (onBegin) {
            this.onRollback = onRollback;
        }
    }

    onBegin(session) {
    }

    onCommit(session, resultSet) {
    }

    onRollback(session, error) {
    }

}

export class SQLiteQueueListener extends EventListener {

    constructor({handleExecution=null}={}) {
        super();
        if (handleExecution) {
            this.handleExecution = handleExecution;
        }
    }

    handleExecution(event) {

    }
}

export class SQLiteParseEvent extends EventObject {

    constructor({source, id = 901, priority = 0, data = null, when = Date.now()} = {}) {
        super({source, id, priority, data, when});
        if (this.id === ANY_EVENT) {
            this.id = SQLiteParseEvent.PARSE;
        }
    }

}
SQLiteParseEvent.FIRST = 900;
SQLiteParseEvent.PARSE = SQLiteParseEvent.FIRST + 1;
SQLiteParseEvent.LAST = 901;

export class SQLiteParserListener extends EventListener {

    constructor({onParseEvent = null}) {
        super();
        if (onParseEvent) {
            this.onParseEvent = onParseEvent;
        }
    }

    onParseEvent(evt) {
    }

}
