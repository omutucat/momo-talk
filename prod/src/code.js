//プロパティ読み込み

//登録用スプレッドシートID
const GSS_USERS_SHEETID = PropertiesService.getScriptProperties().getProperty('GSS_USERS_SHEETID');
const GSS_USERS_SHEATNAME = PropertiesService.getScriptProperties().getProperty('GSS_USERS_SHEATNAME');
//Trello API関連
const TRELLO_API_URL = PropertiesService.getScriptProperties().getProperty('TRELLO_API_URL');
const TRELLO_USER_ID = PropertiesService.getScriptProperties().getProperty('TRELLO_USER_ID');
const TRELLO_KEY = PropertiesService.getScriptProperties().getProperty('TRELLO_KEY');
//Discord API関連
const DISCORD_WEBHOOK_URL = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK_URL');
//その他
const FILTER_TARGET_WORDS = PropertiesService.getScriptProperties().getProperty('FILTER_TARGET_WORDS').split(',');
const BORDER_CLOSETASK = PropertiesService.getScriptProperties().getProperty('BORDER_CLOSETASK');
//ユウカのセリフ
const MESSAGE_TO_CLOSETASK = "先生！以下のタスクが期限間近です。後回しにせず、早く取り掛かってくださいね。";
const MESSAGE_TO_EXPIREDTASK = "先生？以下のタスクはもう期限を過ぎていますよ！全く、しっかりしてください！";

//定数
const ONEHOUR_BY_MILISEC = 3600000;

//main関数
function Main() {
    const registeredUsers = getUsersFromSheet();

    for (let user of registeredUsers) {
        const allBoards = getBoards(user.trelloToken);
        const targetBoards = filterBoard(allBoards);
        const allCards = getAllCardsFromBoards(user.trelloToken, targetBoards);
        const tasks = createTasks(allCards);

        postCloseTasks(tasks, user);
        postExpiredTasks(tasks, user);
    }
}

//Googleスプレッドシートから登録ユーザーの一覧を得る
function getUsersFromSheet() {
    const spreadsheetId = GSS_USERS_SHEETID;
    const sheetName = GSS_USERS_SHEATNAME;
    const startRow = 2;   //1行目はカラム名行
    const startColumn = 1;
    const numColumns = 5;

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName(sheetName);

    const users = [];

    let row = startRow;
    let hasData = true;

    while (hasData) {
        const rowData = sheet.getRange(row, startColumn, 1, numColumns).getValues()[0];

        if (rowData.join("") !== "") {
            const _timeStamp = rowData[0];
            const _mailAddr = rowData[1];
            const _userName = rowData[2];
            const _discordUserId = rowData[3];
            const _trelloToken = rowData[4];

            //メールアドレスを照合して同一ユーザが居ないか検索する。
            const sameUserIndex = users.findIndex(function (value) { return value.mailAddr == _mailAddr });
            if (sameUserIndex == -1) {
                users.push({
                    'timeStamp': _timeStamp
                    , 'mailAddr': _mailAddr
                    , 'userName': _userName
                    , 'discordUserId': _discordUserId
                    , 'trelloToken': _trelloToken
                });
            } else {
                //同一ユーザーが居ればタイムスタンプが新しい方のデータを優先する。
                if (new Date(users[sameUserIndex].timeStamp) < new Date(_timeStamp)) {
                    users[sameUserIndex].userName = _userName;
                    users[sameUserIndex].timeStamp = _timeStamp;
                    users[sameUserIndex].trelloToken = _trelloToken;
                    users[sameUserIndex].discordUserId = _discordUserId;
                }
            }
            row++;
        } else {
            hasData = false;
        }
    }

    return users;
}

//受け取ったカードから期限が入ったものを抽出してタスク一覧を生成
function createTasks(cards) {
    const resultTasks = [];
    const nowDateTime = new Date();
    for (let card of cards) {
        if (card.due != null && !card.dueComplete) {
            const timeLeft = Utilities.parseDate(card.due, "UTC", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") - nowDateTime;
            resultTasks.push({
                'name': `${card.board}/${card.list}/${card.name}`
                , 'timeLeft': timeLeft
            })
        }
    }
    return resultTasks;
}

//受け取ったボード一覧から、含まれるカードをすべて抽出
function getAllCardsFromBoards(token, boards) {
    const resultCards = [];
    for (let board of boards) {
        const lists = getLists(token, board);
        for (let list of lists) {
            const cards = getCards(token, list);
            for (let card of cards) {
                resultCards.push(card);
            }
        }
    }
    return resultCards;
}

//すべてのボードから名前に対象文字列が含まれるボードを抽出
function filterBoard(boards) {
    const resultBoards = [];
    for (let board of boards) {
        for (let targetWord of FILTER_TARGET_WORDS) {
            if (board.name.match(targetWord)) {
                resultBoards.push(board);
                boards.pop(board);
            }
        }
    }
    return resultBoards;
}

//タスク一覧から期限間近のタスクをDiscordに投稿
function postCloseTasks(tasks, user) {
    let taskString = "";
    for (let task of tasks) {
        if (task.timeLeft < BORDER_CLOSETASK && task.timeLeft > 0) {
            taskString = taskString.concat(`${task.name}: 残り${Math.round(task.timeLeft / ONEHOUR_BY_MILISEC).toString()}時間\n`);
        }
    }
    if (taskString != "") {
        postMessageToDiscord(`<@${user.discordUserId}>\n${user.userName}${MESSAGE_TO_CLOSETASK}\n${taskString}`);
    }
}

//タスク一覧から期限が過ぎたタスクをDiscordに投稿
function postExpiredTasks(tasks, user) {
    let taskString = "";
    for (let task of tasks) {
        if (task.timeLeft < 0) {
            taskString = taskString.concat(`${task.name}: 期限を${Math.abs(Math.round(task.timeLeft / ONEHOUR_BY_MILISEC)).toString()}時間超過\n`);
        }
    }
    if (taskString != "") {
        postMessageToDiscord(`<@${user.discordUserId}>\n${user.userName}${MESSAGE_TO_EXPIREDTASK}\n${taskString}`);
    }
}

////ここからAPI関連

//Trello API
function getBoards(token) {
    const params = {
        'method': 'GET',
        'headers': { 'ContentType': 'application/json' },
    };
    const url = TRELLO_API_URL + '1/members/' + TRELLO_USER_ID + '/boards'
        + '?key=' + TRELLO_KEY
        + '&token=' + token;
    let result = UrlFetchApp.fetch(url, params).getContentText();
    return JSON.parse(result);
}

function getLists(token, board) {
    const params = {
        'method': 'GET',
        'headers': { 'ContentType': 'application/json' },
    };
    const url = TRELLO_API_URL + '1/boards/' + board.id + '/lists'
        + '?key=' + TRELLO_KEY
        + '&token=' + token;
    const response = UrlFetchApp.fetch(url, params).getContentText();
    let result = JSON.parse(response);
    for (let list of result) {
        list.board = board.name;
    }
    return result;
}

function getCards(token, list) {
    const params = {
        'method': 'GET',
        'headers': { 'ContentType': 'application/json' },
    };
    const url = TRELLO_API_URL + '1/lists/' + list.id + '/cards'
        + '?key=' + TRELLO_KEY
        + '&token=' + token;
    const response = UrlFetchApp.fetch(url, params).getContentText();
    let result = JSON.parse(response);
    for (let card of result) {
        card.board = list.board;
        card.list = list.name;
    }
    return result;
}

//Discord API

function postMessageToDiscord(message) {
    //Discordにポストするデータは改行が\r
    const _payload = JSON.stringify({ "content": message.replace("\n", "\r") });
    const _params = {
        'method': 'POST',
        'headers': { 'Content-Type': 'application/json' },
        'payload': _payload
    };
    UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, _params);
}
