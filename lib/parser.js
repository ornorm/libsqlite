/** @babel */
import {ANY_EVENT, EventListener, EventObject} from "eventslib/lib/event";
import {EventListenerAggregate} from "eventslib/lib/aggregate";
import {HTTPConnection, LOAD_END_STATE} from "libhttp/lib/http";
import {SQLiteParseEvent, SQLiteParserListener} from './event';

export class SQLiteParser {

    constructor() {
        this.mListeners = new EventListenerAggregate(SQLiteParserListener);
        this.inComment = false;
        this.mStatements = [];
    }

    addListener(listener) {
        this.mListeners.add(listener);
    }

    getStatements() {
        return this.mStatements;
    }

    loadFile(path) {
        new HTTPConnection({
            url: path,
            method : "GET",
            responseType: "text",
            handler: {

                onHandleRequest: (event) => {
                    let type = event.type;
                    if (type === LOAD_END_STATE) {
                        this.parse(event.response.getMessageBody());
                    }
                }

            }
        });
    }

    notifyListeners() {
        let listeners = this.mListeners.getListenersInternal();
        for (const listener of listeners) {
            listener.onParseEvent(new SQLiteParseEvent({
                source : this,
                id : SQLiteParseEvent.PARSE,
                data : this.mStatements
            }));
        }
    }

    parse(data) {
        let lines = data.split("\n");
        let statement = "";
        for (let line of lines) {
            line = SQLiteParser.stripOffTrailingComment(line).trim();
            if (line.length === 0) {
                continue;
            }
            if (line.indexOf(SQLiteParser.BLOCK_COMMENT_START_CHARACTERS) === 0) {
                this.mInComment = true;
                continue;
            }
            if (this.mInComment && (line.indexOf(SQLiteParser.BLOCK_COMMENT_END_CHARACTERS) === line.length - 1)) {
                this.inComment = false;
                continue;
            }
            if (this.mInComment) {
                continue;
            }
            statement += line;
            if (!(line.indexOf(SQLiteParser.STATEMENT_END_CHARACTER) === line.length - 1)) {
                statement += SQLiteParser.LINE_CONCATENATION_CHARACTER;
                continue;
            }
            this.mStatements.push(statement);
            statement = "";
        }
        this.notifyListeners();
    }

    removeListener(listener) {
        this.mListeners.remove(listener);
    }

    static stripOffTrailingComment(line) {
        let commentStartIndex = line.indexOf(SQLiteParser.LINE_COMMENT_START_CHARACTERS);
        if (commentStartIndex !== -1) {
            return line.substring(0, commentStartIndex);
        }
        return line;
    }

}

SQLiteParser.DEFAULT_CREATE_MODEL_FILE = "create_model.sql";
SQLiteParser.DEFAULT_DROP_MODEL_FILE = "drop_model.sql";
SQLiteParser.STATEMENT_END_CHARACTER = ";";
SQLiteParser.LINE_COMMENT_START_CHARACTERS = "--";
SQLiteParser.BLOCK_COMMENT_START_CHARACTERS = "/*";
SQLiteParser.BLOCK_COMMENT_END_CHARACTERS = "*/";
SQLiteParser.LINE_CONCATENATION_CHARACTER = " ";
SQLiteParser.LINE_END = " ";