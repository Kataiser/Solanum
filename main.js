const DEBUG = true;
const ENGINE_COUNT = 16;
const SEARCH_TIME = 10000;
const TOTAL_HASH = 256;


// ENGINE STARTUP

let workers = [];

function initEngineWorkers() {
    for (let i = 0; i < ENGINE_COUNT; i++) {
        workers[i] = new sfWorker(i);
    }
}


// ENGINE CORE

function engineThink() {
    engineDebugLog("thonk");

    let auxBoard = auxillaryBoardArray[0];
    let startPos = auxBoard.string;
    let startFEN = `${startPos.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${startPos} w KkQq - 0 1`;
    let moves = auxillaryBoardArray[0].moves.join(" ");
    workers[0].go(startFEN, moves);
}

function makeEngineMove(move) {
    let r = move[0];
    let c = move[1];
    heldPiece = mainBoard.pieceArray[r][c];
    heldPiece.r = r; heldPiece.c = c;
    makeMoves(move);
    mainBoard.lastMove = move;
}


// DEBUG

function randomMove() {
    let fullMoves = [];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (mainBoard.pieceArray[r][c] && mainBoard.currentMove === mainBoard.pieceArray[r][c].colour) {
                for (let board of auxillaryBoardArray) {
                    for (let move of board.getLegalMoves(r, c, true, false)) {
                        let fullMove = [r, c, ...move];

                        if (!fullMoves.some(matchFullMove(fullMove)))
                            fullMoves.push(fullMove);
                    }
                }
            }
        }
    }

    return fullMoves[Math.floor(Math.random() * fullMoves.length)];
}

function engineDebugLog(log) {
    if (DEBUG) {
        console.log(log);
    }
}

// MISC

let matchFullMove = a => (b => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);