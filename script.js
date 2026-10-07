import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

const STOCKFISH_PATH = "./stockfish/stockfish-19-lite-single.js";

let engine = null;
let engineReady = false;

let game = null;
let positions = [];
let reviewMoves = [];
let currentIndex = 0;

let engineDepth = 16;


/* =========================================================
   DOM
========================================================= */

const $ = id => document.getElementById(id);

const inputSection = $("inputSection");
const reviewSection = $("reviewSection");
const loadingOverlay = $("loadingOverlay");

const pgnInput = $("pgnInput");
let startReview = analyzeGame;
const analyzeButton = $("analyzeButton");
const depthSelect = $("depthSelect");

const loadingText = $("loadingText");
const loadingProgress = $("loadingProgress");
const loadingPercent = $("loadingPercent");
const loadingMove = $("loadingMove");


/* =========================================================
   STOCKFISH
========================================================= */

function initEngine() {

  try {

    engine = new Worker(STOCKFISH_PATH);

    engine.onmessage = event => {

      const line = String(event.data);

      if (line === "readyok") {

        engineReady = true;

        $("engineStatus").textContent = "Stockfish 19 ready";

        const dot = document.querySelector(".engine-dot");

        if (dot) {
          dot.style.background = "#39d98a";
        }
      }
    };

    engine.postMessage("uci");
    engine.postMessage("isready");

  } catch (error) {

    console.error(error);

    $("engineStatus").textContent = "Engine unavailable";

  }

}

initEngine();


/* =========================================================
   ENGINE SEARCH
========================================================= */

function waitForEngine() {

  return new Promise(resolve => {

    const check = () => {

      if (engineReady) {
        resolve();
      } else {
        setTimeout(check, 100);
      }

    };

    check();

  });

}


function analyzePosition(fen, depth) {

  return new Promise((resolve, reject) => {

    let score = 0;
    let mate = null;
    let bestmove = null;

    const timeout = setTimeout(() => {

      engine.onmessage = null;

      reject(new Error("Stockfish timeout"));

    }, 30000);


    engine.onmessage = event => {

      const line = String(event.data);


      if (line.startsWith("info") && line.includes("score")) {

        const mateMatch = line.match(/score\s+cp\s+(-?\d+)/);

        const mateValue = line.match(/score\s+mate\s+(-?\d+)/);

        if (mateMatch) {
          score = parseInt(mateMatch[1], 10);
          mate = null;
        }

        if (mateValue) {
          mate = parseInt(mateValue[1], 10);
        }

      }


      if (line.startsWith("bestmove")) {

        clearTimeout(timeout);

        const parts = line.split(/\s+/);

        bestmove = parts[1] || null;

        resolve({
          cp: score,
          mate,
          bestmove
        });

      }

    };


    engine.postMessage("ucinewgame");
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${depth}`);

  });

}


/* =========================================================
   SCORE HELPERS
========================================================= */

function scoreToWhite(score) {

  if (score.mate !== null) {

    return score.mate > 0
      ? 10000
      : -10000;

  }

  return score.cp;

}


function winProbability(cp) {

  const x = cp / 100;

  return 1 / (1 + Math.exp(-x * 0.55));

}


function expectedPoints(cp) {

  return winProbability(cp);

}


function calculateCPL(before, after, side) {

  const beforeWhite = scoreToWhite(before);
  const afterWhite = scoreToWhite(after);

  const beforeEP = expectedPoints(beforeWhite);
  const afterEP = expectedPoints(afterWhite);

  let loss;

  if (side === "w") {
    loss = beforeEP - afterEP;
  } else {
    loss = afterEP - beforeEP;
  }

  return Math.max(0, Math.round(loss * 100));

}


/* =========================================================
   MOVE CLASSIFICATION
========================================================= */

function classifyMove(move, before, after, previousMove) {

  const cpl = move.cpl;

  const best = move.bestmove === move.uci;

  const tactical =
    move.san.includes("x") ||
    move.san.includes("+") ||
    move.san.includes("#");


  /*
    Transparent classification system.

    It is intentionally independent from Chess.com's
    proprietary classification implementation.
  */

  if (best && tactical && cpl <= 3) {

    return "Brilliant";

  }

  if (best && cpl <= 8) {

    return "Best";

  }

  if (cpl <= 18) {

    return "Excellent";

  }

  if (cpl <= 35) {

    return "Good";

  }

  if (cpl <= 60) {

    return "Inaccuracy";

  }

  if (cpl <= 110) {

    return "Mistake";

  }

  if (
    previousMove &&
    previousMove.cpl >= 80 &&
    cpl >= 60
  ) {

    return "Miss";

  }

  return "Blunder";

}


/* =========================================================
   SAN / UCI
========================================================= */

function uciToSan(chess, uci) {

  if (!uci || uci.length < 4) {
    return uci || String.fromCodePoint(0x2014);
  }

  try {

    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);

    const promotion =
      uci.length > 4
        ? uci[4]
        : undefined;

    const temp = new Chess(chess.fen());

    const move = temp.move({
      from,
      to,
      promotion
    });

    return move ? move.san : uci;

  } catch {

    return uci;

  }

}


/* =========================================================
   EXPLANATIONS
========================================================= */

function createExplanation(move) {

  if (move.classification === "Brilliant") {

    return "A very precise tactical decision. The engine strongly approves this move and the position remains highly favorable.";

  }

  if (move.classification === "Best") {

    return "This is the engine's preferred move. You maintained the strongest continuation available in the position.";

  }

  if (move.classification === "Excellent") {

    return "A very strong move. It keeps almost all of the position's available advantage.";

  }

  if (move.classification === "Good") {

    return "A solid practical move. The engine sees only a small difference from the strongest continuation.";

  }

  if (move.classification === "Book") {

    return "This move follows established opening practice.";

  }

  if (move.classification === "Inaccuracy") {

    return "A small loss of precision. Look for a more active or concrete continuation next time.";

  }

  if (move.classification === "Mistake") {

    return "This move gives the opponent a meaningful improvement. Compare it with the engine's suggested move.";

  }

  if (move.classification === "Miss") {

    return "You missed an important opportunity in the position. This was a moment where a stronger continuation was available.";

  }

  if (move.classification === "Blunder") {

    return "A major evaluation swing. Before playing this type of move, check your opponent's forcing checks, captures and threats.";

  }

  return "Engine analysis completed for this move.";

}


/* =========================================================
   PGN PARSING
========================================================= */

function parseHeaders(pgn) {

  const headers = {};

  const regex = /^\s*\[([A-Za-z0-9_]+)\s+"([^"]*)"\]\s*$/gm;

  let match;

  while ((match = regex.exec(pgn))) {
    headers[match[1]] = match[2];
  }

  return headers;

}


/* =========================================================
   LOADING UI
========================================================= */

function showLoading(text = "Preparing Stockfish...") {

  loadingOverlay.classList.remove("hidden");

  loadingText.textContent = text;
  loadingProgress.style.width = "0%";
  loadingPercent.textContent = "0%";
  loadingMove.textContent = "Preparing...";

}


function updateLoading(done, total, label) {

  const percent =
    total > 0
      ? Math.round((done / total) * 100)
      : 0;

  loadingProgress.style.width = `${percent}%`;
  loadingPercent.textContent = `${percent}%`;
  loadingMove.textContent = label;

}


function hideLoading() {

  loadingOverlay.classList.add("hidden");

}


/* =========================================================
   ANALYZE GAME
========================================================= */

async function analyzeGame() {

  const pgn = pgnInput.value.trim();

  if (!pgn) {

    alert("Please paste a PGN first.");

    return;

  }


  showLoading();

  await waitForEngine();

  engineDepth = parseInt(depthSelect.value, 10);


  let chess;

  try {

    chess = new Chess();

    chess.loadPgn(pgn);

  } catch (error) {

    console.error(error);

    hideLoading();

    alert(
      "Invalid PGN.\n\nPlease paste the complete PGN from Chess.com."
    );

    return;

  }


  const headers = parseHeaders(pgn);

  const history = chess.history({
    verbose: true
  });

  if (!history.length) {

    hideLoading();

    alert("No moves found in this PGN.");

    return;

  }


  game = new Chess();

  positions = [
    game.fen()
  ];

  reviewMoves = [];


  for (let i = 0; i < history.length; i++) {

    const move = history[i];

    const side = game.turn();

    const beforeFen = game.fen();


    updateLoading(
      i,
      history.length,
      `Analyzing ${Math.floor(i / 2) + 1}${side === "w" ? "." : "..."} ${move.san}`
    );


    const before = await analyzePosition(
      beforeFen,
      engineDepth
    );


    const played = game.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion
    });


    const afterFen = game.fen();


    const after = await analyzePosition(
      afterFen,
      engineDepth
    );


    const bestSan =
      uciToSan(
        new Chess(beforeFen),
        before.bestmove
      );


    const cpl = calculateCPL(
      before,
      after,
      side
    );


    const item = {

      ply: i + 1,

      moveNumber:
        Math.floor(i / 2) + 1,

      side,

      san: played.san,

      uci:
        played.from +
        played.to +
        (played.promotion || ""),

      bestmove:
        before.bestmove,

      bestSan,

      cpl,

      beforeCp:
        scoreToWhite(before),

      afterCp:
        scoreToWhite(after),

      fen:
        afterFen,

      beforeFen,

      mate:
        after.mate,

      classification:
        "Good"

    };


    const previous =
      reviewMoves[reviewMoves.length - 1] ||
      null;


    item.classification =
      classifyMove(
        item,
        before,
        after,
        previous
      );


    item.explanation =
      createExplanation(item);


    reviewMoves.push(item);

    positions.push(afterFen);

  }


  updateLoading(
    history.length,
    history.length,
    "Building review..."
  );


  renderReview(headers);

  hideLoading();

}


/* =========================================================
   CATEGORY
========================================================= */

const CATEGORY_ORDER = [
  "Brilliant",
  "Great",
  "Best",
  "Excellent",
  "Good",
  "Book",
  "Inaccuracy",
  "Mistake",
  "Miss",
  "Blunder"
];


function renderCategories() {

  const container = $("categoryRows");

  container.innerHTML = "";


  for (const category of CATEGORY_ORDER) {

    const white =
      reviewMoves.filter(
        m =>
          m.side === "w" &&
          m.classification === category
      ).length;


    const black =
      reviewMoves.filter(
        m =>
          m.side === "b" &&
          m.classification === category
      ).length;


    const total = white + black;


    const card =
      document.createElement("div");

    card.className =
      "category-card";


    card.innerHTML = `

      <div class="category-name">
        ${category}
      </div>

      <strong>${total}</strong>

      <small>
        ${white} White ${String.fromCodePoint(0x00B7)} ${black} Black
      </small>

    `;


    container.appendChild(card);

  }

}


/* =========================================================
   ACCURACY
========================================================= */

function calculateAccuracy(side) {

  const moves =
    reviewMoves.filter(
      m => m.side === side
    );


  if (!moves.length) {
    return 0;
  }


  const average =
    moves.reduce(
      (sum, m) => sum + m.cpl,
      0
    ) / moves.length;


  const accuracy =
    100 *
    Math.exp(
      -average / 135
    );


  return Math.max(
    0,
    Math.min(
      100,
      accuracy
    )
  );

}


/* =========================================================
   PERFORMANCE
========================================================= */

function performanceRating(accuracy) {

  return Math.round(
    300 + accuracy * 9
  );

}


/* =========================================================
   RENDER REVIEW
========================================================= */

function renderReview(headers) {

  const white =
    headers.White ||
    "White";

  const black =
    headers.Black ||
    "Black";

  $("whiteName").textContent = white;
  $("blackName").textContent = black;

  $("whitePlayerName").textContent = white;
  $("blackPlayerName").textContent = black;


  const result =
    headers.Result ||
    String.fromCodePoint(0x2014);

  $("gameResult").textContent = result;

  $("moveCount").textContent =
    `${Math.ceil(reviewMoves.length / 2)} moves`;


  const whiteAccuracy =
    calculateAccuracy("w");

  const blackAccuracy =
    calculateAccuracy("b");


  $("whiteAccuracy").textContent =
    `${whiteAccuracy.toFixed(1)}%`;

  $("blackAccuracy").textContent =
    `${blackAccuracy.toFixed(1)}%`;


  $("whiteAccuracyBar").style.width =
    `${whiteAccuracy}%`;

  $("blackAccuracyBar").style.width =
    `${blackAccuracy}%`;


  $("whiteRating").textContent =
    performanceRating(whiteAccuracy);

  $("blackRating").textContent =
    performanceRating(blackAccuracy);


  renderCategories();

  renderMoveLists();

  renderGraph();

  renderInsights();

  renderSummary();


  currentIndex = 0;

  renderPosition(0);


  inputSection.classList.add("hidden");

  reviewSection.classList.remove("hidden");

  window.scrollTo({
    top: 0,
    behavior: "instant"
  });

}


/* =========================================================
   MOVE LISTS
========================================================= */

function renderMoveLists() {

  const critical =
    reviewMoves.filter(
      m =>
        [
          "Brilliant",
          "Mistake",
          "Miss",
          "Blunder"
        ].includes(m.classification)
    );


  const criticalList =
    $("criticalMoves");

  const allList =
    $("allMoves");


  criticalList.innerHTML = "";
  allList.innerHTML = "";


  $("criticalCount").textContent =
    critical.length;

  $("allCount").textContent =
    reviewMoves.length;


  critical.forEach(
    move =>
      criticalList.appendChild(
        createMoveRow(move)
      )
  );


  reviewMoves.forEach(
    move =>
      allList.appendChild(
        createMoveRow(move)
      )
  );


  if (!critical.length) {

    criticalList.innerHTML = `
      <div style="
        padding:30px;
        text-align:center;
        color:#667383;
        font-size:11px;
      ">
        No major critical moments found.
      </div>
    `;

  }

}


function createMoveRow(move) {

  const row =
    document.createElement("div");

  row.className = "move-row";

  row.dataset.ply =
    move.ply;


  const side =
    move.side === "w"
      ? ""
      : "...";


  row.innerHTML = `

    <div class="move-number">
      ${move.moveNumber}${side}
    </div>

    <div class="move-san">
      ${move.san}
    </div>

    <div class="
      move-class
      class-${move.classification.toLowerCase()}
    ">
      ${move.classification}
    </div>

  `;


  row.addEventListener(
    "click",
    () => {

      renderPosition(
        move.ply
      );

      document
        .querySelector(".board-column")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });

    }
  );


  return row;

}


/* =========================================================
   BOARD
========================================================= */

const PIECES = {

  wp: String.fromCodePoint(0x2659),
  wn: String.fromCodePoint(0x2658),
  wb: String.fromCodePoint(0x2657),
  wr: String.fromCodePoint(0x2656),
  wq: String.fromCodePoint(0x2655),
  wk: String.fromCodePoint(0x2654),

  bp: String.fromCodePoint(0x265F),
  bn: String.fromCodePoint(0x265E),
  bb: String.fromCodePoint(0x265D),
  br: String.fromCodePoint(0x265C),
  bq: String.fromCodePoint(0x265B),
  bk: String.fromCodePoint(0x265A)
};


function renderPosition(index) {

  if (!positions[index]) {
    return;
  }


  currentIndex = index;


  const chess =
    new Chess(
      positions[index]
    );


  const board =
    $("chessBoard");

  board.innerHTML = "";


  const boardData =
    chess.board();


  boardData.forEach(
    (row, rowIndex) => {

      row.forEach(
        (piece, colIndex) => {

          const square =
            document.createElement("div");

          const isLight =
            (rowIndex + colIndex) % 2 === 0;


          square.className =
            `square ${isLight ? "light" : "dark"}`;


          if (piece) {

            const span =
              document.createElement("span");

            span.className =
              `piece ${piece.color}`;

            span.textContent =
              PIECES[
                piece.color + piece.type
              ];


            square.appendChild(span);

          }


          board.appendChild(square);

        }
      );

    }
  );


  const move =
    reviewMoves[index - 1];


  $("moveCounter").textContent =
    `${index} / ${reviewMoves.length}`;


  if (!move) {

    $("positionLabel").textContent =
      "Starting Position";

    $("evaluation").textContent =
      "0.00";

    $("evalText").textContent =
      "0.00";

    $("currentMoveTitle").textContent =
      "Starting position";

    $("currentMoveBadge").textContent =
      "START";

    $("playedMove").textContent =
      String.fromCodePoint(0x2014);

    $("bestMove").textContent =
      String.fromCodePoint(0x2014);

    $("moveCpl").textContent =
      String.fromCodePoint(0x2014);

    $("moveExplanation").textContent =
      "Start the review and move through the game using the controls.";

    return;

  }


  const evaluation =
    move.afterCp / 100;


  const evaluationText =
    move.mate !== null
      ? `M${Math.abs(move.mate)}`
      : formatEval(evaluation);


  $("positionLabel").textContent =
    `${move.moveNumber}${move.side === "w" ? "." : "..."} ${move.san}`;


  $("evaluation").textContent =
    evaluationText;

  $("evalText").textContent =
    evaluationText;


  $("currentMoveTitle").textContent =
    `${move.moveNumber}${move.side === "w" ? "." : "..."} ${move.san}`;


  $("currentMoveBadge").textContent =
    move.classification;


  $("currentMoveBadge").className =
    `move-badge ${badgeClass(move.classification)}`;


  $("playedMove").textContent =
    move.san;

  $("bestMove").textContent =
    move.bestSan;

  $("moveCpl").textContent =
    move.cpl;


  $("moveExplanation").textContent =
    move.explanation;


  updateEvalBar(
    move.afterCp
  );

}


function formatEval(value) {

  if (Math.abs(value) < .005) {
    return "0.00";
  }

  return value > 0
    ? `+${value.toFixed(2)}`
    : value.toFixed(2);

}


function updateEvalBar(cp) {

  const normalized =
    Math.max(
      -800,
      Math.min(
        800,
        cp
      )
    );


  const percent =
    50 + normalized / 16;


  $("evalFill").style.height =
    `${Math.max(3, Math.min(97, percent))}%`;

}


function badgeClass(category) {

  if (
    category === "Best" ||
    category === "Brilliant"
  ) {
    return "best";
  }

  if (
    category === "Mistake" ||
    category === "Inaccuracy"
  ) {
    return "mistake";
  }

  if (
    category === "Miss" ||
    category === "Blunder"
  ) {
    return "blunder";
  }

  return "good";

}


/* =========================================================
   GRAPH
========================================================= */

function renderGraph() {

  const canvas =
    $("evaluationGraph");

  const ctx =
    canvas.getContext("2d");


  const rect =
    canvas.getBoundingClientRect();


  const dpr =
    window.devicePixelRatio || 1;


  canvas.width =
    rect.width * dpr;

  canvas.height =
    rect.height * dpr;


  ctx.scale(dpr, dpr);


  const width =
    rect.width;

  const height =
    rect.height;


  ctx.clearRect(
    0,
    0,
    width,
    height
  );


  if (!reviewMoves.length) {
    return;
  }


  /*
    Background
  */

  ctx.strokeStyle =
    "rgba(255,255,255,.06)";

  ctx.lineWidth = 1;


  for (let i = 1; i < 4; i++) {

    const y =
      (height / 4) * i;

    ctx.beginPath();

    ctx.moveTo(0, y);
    ctx.lineTo(width, y);

    ctx.stroke();

  }


  /*
    Center line
  */

  ctx.strokeStyle =
    "rgba(255,255,255,.15)";

  ctx.beginPath();

  ctx.moveTo(
    0,
    height / 2
  );

  ctx.lineTo(
    width,
    height / 2
  );

  ctx.stroke();


  const values = [
    0,
    ...reviewMoves.map(
      m =>
        Math.max(
          -600,
          Math.min(
            600,
            m.afterCp
          )
        )
    )
  ];


  const points =
    values.map(
      (value, index) => {

        const x =
          index /
          (values.length - 1) *
          width;


        const y =
          height / 2 -
          value /
          1200 *
          height;


        return {
          x,
          y
        };

      }
    );


  /*
    Fill
  */

  ctx.beginPath();

  ctx.moveTo(
    points[0].x,
    height / 2
  );


  for (const p of points) {
    ctx.lineTo(p.x, p.y);
  }


  ctx.lineTo(
    points[points.length - 1].x,
    height / 2
  );

  ctx.closePath();

  ctx.fillStyle =
    "rgba(57,217,138,.07)";

  ctx.fill();


  /*
    Line
  */

  ctx.beginPath();

  points.forEach(
    (p, i) => {

      if (i === 0) {
        ctx.moveTo(
          p.x,
          p.y
        );
      } else {
        ctx.lineTo(
          p.x,
          p.y
        );
      }

    }
  );


  ctx.strokeStyle =
    "#39d98a";

  ctx.lineWidth = 2;

  ctx.stroke();


  /*
    Critical markers
  */

  reviewMoves.forEach(
    (move, i) => {

      if (
        ![
          "Mistake",
          "Miss",
          "Blunder"
        ].includes(
          move.classification
        )
      ) {
        return;
      }


      const p =
        points[i + 1];


      ctx.beginPath();

      ctx.arc(
        p.x,
        p.y,
        3.5,
        0,
        Math.PI * 2
      );


      ctx.fillStyle =
        move.classification === "Blunder"
          ? "#ff5f6d"
          : "#ff9d57";

      ctx.fill();

    }
  );

}


/* =========================================================
   INSIGHTS
========================================================= */

function renderInsights() {

  const critical =
    reviewMoves.filter(
      m =>
        [
          "Mistake",
          "Miss",
          "Blunder"
        ].includes(
          m.classification
        )
    ).length;


  const average =
    reviewMoves.reduce(
      (sum, m) =>
        sum + m.cpl,
      0
    ) /
    Math.max(
      1,
      reviewMoves.length
    );


  const tactical =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(
          100 -
          average * .8
        )
      )
    );


  $("tacticalScore").textContent =
    `${tactical}/100`;

  $("tacticalText").textContent =
    critical === 0
      ? "Excellent tactical consistency across the game."
      : `${critical} critical decision${critical === 1 ? "" : "s"} affected the game.`;


  const king =
    calculateKingSafety();


  $("kingSafetyScore").textContent =
    `${king}/100`;

  $("kingSafetyText").textContent =
    king >= 80
      ? "Your king remained relatively safe."
      : "King exposure and tactical pressure deserve more attention.";


  const strategy =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(
          100 -
          average * .65
        )
      )
    );


  $("strategyScore").textContent =
    `${strategy}/100`;

  $("strategyText").textContent =
    strategy >= 80
      ? "Good positional consistency."
      : "Look for stronger plans instead of reacting move by move.";


  const endgame =
    reviewMoves.length > 40
      ? Math.round(
          Math.max(
            0,
            Math.min(
              100,
              100 - average
            )
          )
        )
      : 0;


  $("endgameScore").textContent =
    reviewMoves.length > 40
      ? `${endgame}/100`
      : "N/A";

  $("endgameText").textContent =
    reviewMoves.length > 40
      ? "The game contained a substantial late phase."
      : "Not enough moves to meaningfully evaluate the endgame.";

}


function calculateKingSafety() {

  let score = 100;


  for (const move of reviewMoves) {

    if (
      move.san.includes("+")
    ) {
      score -= 3;
    }

    if (
      move.san.includes("#")
    ) {
      score -= 30;
    }

  }


  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );

}


/* =========================================================
   SUMMARY
========================================================= */

function renderSummary() {

  const critical =
    reviewMoves.filter(
      m =>
        [
          "Mistake",
          "Miss",
          "Blunder"
        ].includes(
          m.classification
        )
    );


  const average =
    reviewMoves.reduce(
      (sum, m) =>
        sum + m.cpl,
      0
    ) /
    Math.max(
      1,
      reviewMoves.length
    );


  $("summaryCritical").textContent =
    critical.length;


  $("summaryCpl").textContent =
    Math.round(average);


  const phases = {
    Opening: [],
    Middlegame: [],
    Endgame: []
  };


  reviewMoves.forEach(
    move => {

      const moveNo =
        move.moveNumber;

      if (moveNo <= 10) {
        phases.Opening.push(move.cpl);
      } else if (moveNo <= 30) {
        phases.Middlegame.push(move.cpl);
      } else {
        phases.Endgame.push(move.cpl);
      }

    }
  );


  let bestPhase = "Opening";
  let bestAverage = Infinity;


  for (const [
    phase,
    values
  ] of Object.entries(phases)) {

    if (!values.length) {
      continue;
    }


    const avg =
      values.reduce(
        (a,b) => a + b,
        0
      ) / values.length;


    if (avg < bestAverage) {

      bestAverage = avg;
      bestPhase = phase;

    }

  }


  $("summaryBestPhase").textContent =
    bestPhase;


  const worst =
    critical
      .sort(
        (a,b) =>
          b.cpl - a.cpl
      )[0];


  let summary;


  if (!worst) {

    summary =
      "A remarkably clean game with no major engine-defined turning points. Your decisions stayed consistently close to the strongest available moves.";

  } else {

    summary =
      `The game was mostly stable, but ${worst.moveNumber}${worst.side === "w" ? "." : "..."} ${worst.san} was the biggest turning point with ${worst.cpl} CPL. The strongest improvement is to slow down at critical positions and compare forcing moves before committing.`;

  }


  $("gameSummary").textContent =
    summary;

}


/* =========================================================
   TABS
========================================================= */

document
  .querySelectorAll(".tab")
  .forEach(
    tab => {

      tab.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(".tab")
            .forEach(
              t =>
                t.classList.remove(
                  "active"
                )
            );


          tab.classList.add("active");


          const type =
            tab.dataset.tab;


          if (type === "critical") {

            $("criticalMoves")
              .classList.remove(
                "hidden"
              );

            $("allMoves")
              .classList.add(
                "hidden"
              );

          } else {

            $("criticalMoves")
              .classList.add(
                "hidden"
              );

            $("allMoves")
              .classList.remove(
                "hidden"
              );

          }

        }
      );

    }
  );


/* =========================================================
   CONTROLS
========================================================= */

$("firstMove").addEventListener(
  "click",
  () => renderPosition(0)
);


$("prevMove").addEventListener(
  "click",
  () => {

    renderPosition(
      Math.max(
        0,
        currentIndex - 1
      )
    );

  }
);


$("nextMove").addEventListener(
  "click",
  () => {

    renderPosition(
      Math.min(
        reviewMoves.length,
        currentIndex + 1
      )
    );

  }
);


$("lastMove").addEventListener(
  "click",
  () =>
    renderPosition(
      reviewMoves.length
    )
);


document.addEventListener(
  "keydown",
  event => {

    if (
      reviewSection.classList.contains(
        "hidden"
      )
    ) {
      return;
    }


    if (event.key === "ArrowLeft") {

      renderPosition(
        Math.max(
          0,
          currentIndex - 1
        )
      );

    }


    if (event.key === "ArrowRight") {

      renderPosition(
        Math.min(
          reviewMoves.length,
          currentIndex + 1
        )
      );

    }

  }
);


/* =========================================================
   START REVIEW
========================================================= */

$("startReviewButton")
  .addEventListener(
    "click",
    () => {

      $("detailedAnalysis")
        ?.scrollIntoView({
          behavior: "smooth"
        });

    }
  );


/* =========================================================
   ANALYZE
========================================================= */

analyzeButton.addEventListener(
  "click",
  startReview
);


/* =========================================================
   NEW GAME
========================================================= */

function resetReview() {

  reviewSection.classList.add(
    "hidden"
  );

  inputSection.classList.remove(
    "hidden"
  );

  pgnInput.value = "";

  reviewMoves = [];

  positions = [];

  currentIndex = 0;

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


$("newGameButton")
  .addEventListener(
    "click",
    resetReview
  );


$("newGameButton2")
  .addEventListener(
    "click",
    resetReview
  );


/* =========================================================
   WINDOW RESIZE
========================================================= */

window.addEventListener(
  "resize",
  () => {

    if (
      !reviewSection.classList.contains(
        "hidden"
      )
    ) {
      renderGraph();
    }

  }
);/* =========================================================
   CHESS REVIEW PRO String.fromCodePoint(0x2014)” ENGINE ACCURACY PATCH
   Fixes:
   - Stockfish score perspective
   - CPL calculation
   - Best move detection
   - Classification thresholds
   - Better Miss / Blunder logic
========================================================= */

const OLD_analyzePosition = analyzePosition;

analyzePosition = function(fen, depth) {

  return new Promise((resolve, reject) => {

    let rawCp = 0;
    let mate = null;
    let bestmove = null;

    const sideToMove =
      fen.split(" ")[1];

    const timeout = setTimeout(() => {

      engine.onmessage = null;

      reject(
        new Error("Stockfish timeout")
      );

    }, 30000);


    engine.onmessage = event => {

      const line =
        String(event.data);


      if (
        line.startsWith("info") &&
        line.includes("score")
      ) {

        const cpMatch =
          line.match(
            /score\s+cp\s+(-?\d+)/
          );

        const mateMatch =
          line.match(
            /score\s+mate\s+(-?\d+)/
          );


        if (cpMatch) {

          rawCp =
            parseInt(
              cpMatch[1],
              10
            );

          mate = null;

        }


        if (mateMatch) {

          mate =
            parseInt(
              mateMatch[1],
              10
            );

        }

      }


      if (
        line.startsWith("bestmove")
      ) {

        clearTimeout(timeout);

        const parts =
          line.trim().split(/\s+/);

        bestmove =
          parts[1] || null;


        /*
          Stockfish score is from the
          side-to-move perspective.

          Convert everything to WHITE
          perspective here.
        */

        let whiteCp =
          rawCp;


        let whiteMate =
          mate;


        if (sideToMove === "b") {

          whiteCp =
            -rawCp;


          if (whiteMate !== null) {

            whiteMate =
              -whiteMate;

          }

        }


        resolve({

          cp: whiteCp,

          mate: whiteMate,

          bestmove

        });

      }

    };


    engine.postMessage(
      "ucinewgame"
    );

    engine.postMessage(
      `position fen ${fen}`
    );

    engine.postMessage(
      `go depth ${depth}`
    );

  });

};


/* =========================================================
   CORRECT CPL
========================================================= */

calculateCPL = function(
  before,
  after,
  side
) {

  const beforeWhite =
    scoreToWhite(before);


  const afterWhite =
    scoreToWhite(after);


  /*
    White wants evaluation to increase.
    Black wants evaluation to decrease.
  */

  let loss;


  if (side === "w") {

    loss =
      beforeWhite -
      afterWhite;

  } else {

    loss =
      afterWhite -
      beforeWhite;

  }


  /*
    Convert engine evaluation loss
    into expected-points style CPL.
  */

  const beforeEP =
    expectedPoints(
      beforeWhite
    );


  const afterEP =
    expectedPoints(
      afterWhite
    );


  let epLoss;


  if (side === "w") {

    epLoss =
      beforeEP -
      afterEP;

  } else {

    epLoss =
      afterEP -
      beforeEP;

  }


  /*
    Blend raw evaluation and
    expected-points loss.

    This keeps small engine noise
    from creating fake mistakes.
  */

  const rawLoss =
    Math.max(
      0,
      loss
    );


  const epCpl =
    Math.max(
      0,
      epLoss * 100
    );


  const rawCpl =
    rawLoss / 8;


  return Math.round(
    Math.max(
      0,
      epCpl * 0.75 +
      rawCpl * 0.25
    )
  );

};


/* =========================================================
   BETTER CLASSIFICATION
========================================================= */

classifyMove = function(
  move,
  before,
  after,
  previousMove
) {

  const cpl =
    move.cpl;


  const best =
    !!move.bestmove &&
    move.bestmove === move.uci;


  const tactical =
    move.san.includes("x") ||
    move.san.includes("+") ||
    move.san.includes("#");


  /*
    Brilliant should be rare.

    A tactical best move with
    meaningful position change.
  */

  if (
    best &&
    tactical &&
    cpl <= 3
  ) {

    return "Brilliant";

  }


  /*
    Actual engine best move.
  */

  if (
    best &&
    cpl <= 8
  ) {

    return "Best";

  }


  if (cpl <= 18) {

    return "Excellent";

  }


  if (cpl <= 35) {

    return "Good";

  }


  /*
    Opening inaccuracies are
    intentionally softer.
  */

  if (
    move.moveNumber <= 10 &&
    cpl <= 50
  ) {

    return "Inaccuracy";

  }


  if (cpl <= 55) {

    return "Inaccuracy";

  }


  /*
    Miss:
    player had a meaningful opportunity
    and failed to take it.
  */

  if (
    previousMove &&
    previousMove.cpl >= 80 &&
    cpl >= 45
  ) {

    return "Miss";

  }


  if (cpl <= 100) {

    return "Mistake";

  }


  return "Blunder";

};


/* =========================================================
   BETTER EXPLANATION
========================================================= */

createExplanation = function(move) {

  const c =
    move.classification;


  if (c === "Brilliant") {

    return (
      "A highly precise tactical move. " +
      "The engine confirms that this continuation " +
      "preserves or improves the position."
    );

  }


  if (c === "Best") {

    return (
      "The engine's top choice. " +
      "You found the strongest continuation " +
      "available in this position."
    );

  }


  if (c === "Excellent") {

    return (
      "A very strong move with only a tiny " +
      "difference from the engine's preferred line."
    );

  }


  if (c === "Good") {

    return (
      "A sound practical decision. " +
      "The position remains close to the engine's " +
      "preferred evaluation."
    );

  }


  if (c === "Inaccuracy") {

    return (
      "A small loss of precision. " +
      "The move is playable, but another continuation " +
      "keeps more of the position's potential."
    );

  }


  if (c === "Mistake") {

    return (
      "This move gives the opponent a meaningful " +
      "improvement. Check forcing checks, captures " +
      "and threats before committing."
    );

  }


  if (c === "Miss") {

    return (
      "You missed an important opportunity. " +
      "The position offered a stronger concrete continuation."
    );

  }


  if (c === "Blunder") {

    return (
      "A major evaluation swing. " +
      "This move allows the opponent a strong tactical " +
      "or positional response."
    );

  }


  return (
    "Engine analysis completed for this move."
  );

};


/* =========================================================
   BETTER ACCURACY
========================================================= */

calculateAccuracy = function(side) {

  const moves =
    reviewMoves.filter(
      m => m.side === side
    );


  if (!moves.length) {

    return 0;

  }


  /*
    Expected-points based accuracy.

    This avoids the old situation where
    a few large CPL values could distort
    the whole score.
  */

  const average =
    moves.reduce(
      (sum, move) =>
        sum + move.cpl,
      0
    ) /
    moves.length;


  const accuracy =
    100 *
    Math.exp(
      -average / 115
    );


  return Math.max(
    0,
    Math.min(
      100,
      accuracy
    )
  );

};


/* =========================================================
   PERFORMANCE RATING
========================================================= */

performanceRating = function(
  accuracy
) {

  /*
    Informational single-game
    performance estimate.

    Not an official Chess.com rating.
  */

  return Math.round(
    400 +
    accuracy * 8
  );

};


console.log(
  "%cChess Review Pro: Engine Accuracy Patch Loaded",
  "color:#39d98a;font-weight:bold"
);


/* =========================================================
   CHESS REVIEW PRO String.fromCodePoint(0x2014)” BOARD PRO PATCH
   Adds:
   - Board coordinates
   - Last move highlight
   - Played move arrow
   - Best move arrow
   - Selected move glow
   - Check / checkmate indicator
   - Better board pieces
========================================================= */

const OLD_renderPosition = renderPosition;


/* =========================================================
   BOARD COORDINATES
========================================================= */

function squareName(row, col) {

  const files = [
    "a","b","c","d",
    "e","f","g","h"
  ];

  const ranks = [
    "8","7","6","5",
    "4","3","2","1"
  ];

  return (
    files[col] +
    ranks[row]
  );

}


function findSquareElement(square) {

  const files = {
    a: 0,
    b: 1,
    c: 2,
    d: 3,
    e: 4,
    f: 5,
    g: 6,
    h: 7
  };


  const ranks = {
    8: 0,
    7: 1,
    6: 2,
    5: 3,
    4: 4,
    3: 5,
    2: 6,
    1: 7
  };


  if (!square || square.length !== 2) {
    return null;
  }


  const col =
    files[square[0]];


  const row =
    ranks[square[1]];


  if (
    col === undefined ||
    row === undefined
  ) {
    return null;
  }


  return {
    row,
    col,
    element:
      document.querySelector(
        `.square[data-square="${square}"]`
      )
  };

}


/* =========================================================
   DRAW ARROW
========================================================= */

function drawBoardArrow(
  from,
  to,
  type = "played"
) {

  const board =
    $("chessBoard");

  if (!board || !from || !to) {
    return;
  }


  const fromData =
    findSquareElement(from);

  const toData =
    findSquareElement(to);


  if (
    !fromData ||
    !toData
  ) {
    return;
  }


  const boardRect =
    board.getBoundingClientRect();


  const fromRect =
    fromData.element.getBoundingClientRect();


  const toRect =
    toData.element.getBoundingClientRect();


  const x1 =
    fromRect.left -
    boardRect.left +
    fromRect.width / 2;


  const y1 =
    fromRect.top -
    boardRect.top +
    fromRect.height / 2;


  const x2 =
    toRect.left -
    boardRect.left +
    toRect.width / 2;


  const y2 =
    toRect.top -
    boardRect.top +
    toRect.height / 2;


  const dx =
    x2 - x1;


  const dy =
    y2 - y1;


  const length =
    Math.sqrt(
      dx * dx +
      dy * dy
    );


  const angle =
    Math.atan2(
      dy,
      dx
    ) *
    180 /
    Math.PI;


  const arrow =
    document.createElement(
      "div"
    );


  arrow.className =
    `board-arrow ${type}`;


  arrow.style.width =
    `${Math.max(25, length - 22)}px`;


  arrow.style.left =
    `${x1}px`;


  arrow.style.top =
    `${y1}px`;


  arrow.style.transform =
    `rotate(${angle}deg)`;


  board.appendChild(
    arrow
  );

}


/* =========================================================
   ARROW HEAD
========================================================= */

function createArrowHead(
  x,
  y,
  angle,
  type
) {

  const head =
    document.createElement(
      "div"
    );


  head.className =
    `arrow-head ${type}`;


  head.style.left =
    `${x}px`;


  head.style.top =
    `${y}px`;


  head.style.transform =
    `rotate(${angle}deg)`;


  $("chessBoard")
    .appendChild(head);

}


/* =========================================================
   RENDER BOARD PRO
========================================================= */

renderPosition = function(index) {

  if (!positions[index]) {
    return;
  }


  currentIndex =
    index;


  const chess =
    new Chess(
      positions[index]
    );


  const board =
    $("chessBoard");


  board.innerHTML = "";


  /*
    Board coordinates + pieces
  */

  const boardData =
    chess.board();


  boardData.forEach(
    (row, rowIndex) => {

      row.forEach(
        (piece, colIndex) => {

          const square =
            document.createElement(
              "div"
            );


          const isLight =
            (rowIndex + colIndex) % 2 === 0;


          const name =
            squareName(
              rowIndex,
              colIndex
            );


          square.className =
            `square ${
              isLight
                ? "light"
                : "dark"
            }`;


          square.dataset.square =
            name;


          /*
            Coordinates
          */

          if (colIndex === 0) {

            const rank =
              document.createElement(
                "span"
              );

            rank.className =
              `board-rank ${
                isLight
                  ? "light-label"
                  : "dark-label"
              }`;


            rank.textContent =
              8 - rowIndex;


            square.appendChild(
              rank
            );

          }


          if (rowIndex === 7) {

            const file =
              document.createElement(
                "span"
              );

            file.className =
              `board-file ${
                isLight
                  ? "light-label"
                  : "dark-label"
              }`;


            file.textContent =
              ["a","b","c","d","e","f","g","h"][
                colIndex
              ];


            square.appendChild(
              file
            );

          }


          /*
            Piece
          */

          if (piece) {

            const span =
              document.createElement(
                "span"
              );


            span.className =
              `piece ${
                piece.color === "w"
                  ? "white-piece-glyph"
                  : "black-piece-glyph"
              }`;


            span.textContent =
              PIECES[
                piece.color +
                piece.type
              ];


            square.appendChild(
              span
            );

          }


          board.appendChild(
            square
          );

        }
      );

    }
  );


  /*
    Last move
  */

  const move =
    reviewMoves[index - 1];


  if (move) {

    const from =
      findSquareElement(
        move.uci.slice(0,2)
      );


    const to =
      findSquareElement(
        move.uci.slice(2,4)
      );


    if (from?.element) {

      from.element.classList.add(
        "last-move"
      );

    }


    if (to?.element) {

      to.element.classList.add(
        "last-move"
      );

    }


    /*
      Played move arrow
    */

    drawBoardArrow(
      move.uci.slice(0,2),
      move.uci.slice(2,4),
      "played"
    );


    /*
      Best move arrow.

      Only display when best move
      is different from played move.
    */

    if (
      move.bestmove &&
      move.bestmove !== move.uci
    ) {

      drawBoardArrow(
        move.bestmove.slice(0,2),
        move.bestmove.slice(2,4),
        "best"
      );

    }

  }


  /*
    Move counter
  */

  $("moveCounter").textContent =
    `${index} / ${reviewMoves.length}`;


  /*
    Starting position
  */

  if (!move) {

    $("positionLabel").textContent =
      "Starting Position";


    $("evaluation").textContent =
      "0.00";


    $("evalText").textContent =
      "0.00";


    $("currentMoveTitle").textContent =
      "Starting position";


    $("currentMoveBadge").textContent =
      "START";


    $("currentMoveBadge").className =
      "move-badge good";


    $("playedMove").textContent =
      String.fromCodePoint(0x2014);


    $("bestMove").textContent =
      String.fromCodePoint(0x2014);


    $("moveCpl").textContent =
      String.fromCodePoint(0x2014);


    $("moveExplanation").textContent =
      "Start the review and move through the game using the controls.";


    updateEvalBar(0);

    return;

  }


  /*
    Current evaluation
  */

  const evaluation =
    move.afterCp / 100;


  const evaluationText =
    move.mate !== null
      ? `M${Math.abs(move.mate)}`
      : formatEval(
          evaluation
        );


  $("positionLabel").textContent =
    `${move.moveNumber}${
      move.side === "w"
        ? "."
        : "..."
    } ${move.san}`;


  $("evaluation").textContent =
    evaluationText;


  $("evalText").textContent =
    evaluationText;


  $("currentMoveTitle").textContent =
    `${move.moveNumber}${
      move.side === "w"
        ? "."
        : "..."
    } ${move.san}`;


  $("currentMoveBadge").textContent =
    move.classification;


  $("currentMoveBadge").className =
    `move-badge ${
      badgeClass(
        move.classification
      )
    }`;


  $("playedMove").textContent =
    move.san;


  $("bestMove").textContent =
    move.bestSan ||
    String.fromCodePoint(0x2014);


  $("moveCpl").textContent =
    move.cpl;


  $("moveExplanation").textContent =
    move.explanation;


  updateEvalBar(
    move.afterCp
  );

};


/* =========================================================
   BOARD CLICK String.fromCodePoint(0x2014)” SELECT SQUARE
========================================================= */

document.addEventListener(
  "click",
  event => {

    const square =
      event.target.closest(
        ".square"
      );


    if (!square) {
      return;
    }


    document
      .querySelectorAll(
        ".square.selected"
      )
      .forEach(
        el =>
          el.classList.remove(
            "selected"
          )
      );


    square.classList.add(
      "selected"
    );

  }
);


/* =========================================================
   BOARD STYLE PATCH
========================================================= */

const boardStyle =
document.createElement(
  "style"
);


boardStyle.textContent = `

  #chessBoard {
    position: relative;
    overflow: hidden;
  }

  #chessBoard .square {
    position: relative;
  }

  #chessBoard .square.last-move {
    background:
      linear-gradient(
        rgba(240,200,70,.34),
        rgba(240,200,70,.34)
      ),
      var(--square-bg, transparent);
  }

  #chessBoard .square.selected {
    box-shadow:
      inset 0 0 0 4px
      rgba(57,217,138,.85),
      inset 0 0 25px
      rgba(57,217,138,.2);
    z-index: 4;
  }

  #chessBoard .piece {
    position: relative;
    z-index: 5;
    font-family:
      "Segoe UI Symbol",
      "Noto Sans Symbols",
      serif;
    text-shadow:
      0 2px 2px rgba(0,0,0,.35);
  }

  .white-piece-glyph {
    color: #f7f8fa;
  }

  .black-piece-glyph {
    color: #161b22;
    text-shadow:
      0 1px 1px rgba(255,255,255,.18);
  }

  .board-rank,
  .board-file {
    position: absolute;
    z-index: 8;
    font-size: 9px;
    font-weight: 800;
    pointer-events: none;
  }

  .board-rank {
    top: 3px;
    left: 4px;
  }

  .board-file {
    right: 4px;
    bottom: 3px;
  }

  .light-label {
    color: #65756b;
  }

  .dark-label {
    color: #d9d9d9;
  }

  .board-arrow {
    position: absolute;
    height: 8px;
    border-radius: 99px;
    transform-origin: left center;
    z-index: 12;
    pointer-events: none;
  }

  .board-arrow::after {
    content: "";
    position: absolute;
    right: -4px;
    top: 50%;
    width: 0;
    height: 0;
    transform:
      translateY(-50%);
    border-top: 9px solid transparent;
    border-bottom: 9px solid transparent;
    border-left: 15px solid currentColor;
  }

  .board-arrow.played {
    background: rgba(57,217,138,.78);
    color: rgba(57,217,138,.78);
    box-shadow:
      0 0 12px rgba(57,217,138,.3);
  }

  .board-arrow.best {
    height: 7px;
    background: rgba(93,156,255,.82);
    color: rgba(93,156,255,.82);
    opacity: .9;
    box-shadow:
      0 0 12px rgba(93,156,255,.25);
  }

  .board-arrow.best::after {
    border-top-width: 8px;
    border-bottom-width: 8px;
    border-left-width: 13px;
  }

`;


document.head.appendChild(
  boardStyle
);


console.log(
  "%cChess Review Pro: Board Pro Patch Loaded",
  "color:#5d9cff;font-weight:bold"
);


/* =========================================================
   CHESS REVIEW PRO String.fromCodePoint(0x2014)” INTERACTIVE GRAPH PATCH
   Adds:
   - Click graph to jump to move
   - Hover tooltip
   - Critical move markers
   - Current move marker
   - Better graph scaling
========================================================= */

let graphHoverIndex = -1;


/* =========================================================
   GRAPH CANVAS SETUP
========================================================= */

function getGraphData() {

  return [
    {
      ply: 0,
      cp: 0,
      classification: "Start"
    },

    ...reviewMoves.map(
      move => ({
        ply: move.ply,
        cp: move.afterCp,
        classification:
          move.classification,
        san: move.san,
        moveNumber:
          move.moveNumber,
        side:
          move.side
      })
    )

  ];

}


/* =========================================================
   GRAPH TOOLTIP
========================================================= */

function createGraphTooltip() {

  let tooltip =
    document.getElementById(
      "graphTooltip"
    );


  if (tooltip) {
    return tooltip;
  }


  tooltip =
    document.createElement(
      "div"
    );


  tooltip.id =
    "graphTooltip";


  tooltip.innerHTML = `
    <div class="graph-tooltip-move">
      Move
    </div>

    <div class="graph-tooltip-eval">
      0.00
    </div>

    <div class="graph-tooltip-class">
      String.fromCodePoint(0x2014)”
    </div>
  `;


  document.body.appendChild(
    tooltip
  );


  return tooltip;

}


const graphTooltip =
  createGraphTooltip();


/* =========================================================
   FORMAT GRAPH EVAL
========================================================= */

function graphEval(cp) {

  if (
    Math.abs(cp) < 5
  ) {
    return "0.00";
  }


  const value =
    cp / 100;


  return value > 0
    ? `+${value.toFixed(2)}`
    : value.toFixed(2);

}


/* =========================================================
   GRAPH RENDER
========================================================= */

function drawInteractiveGraph() {

  const canvas =
    $("evaluationGraph");


  if (!canvas) {
    return;
  }


  const rect =
    canvas.getBoundingClientRect();


  const dpr =
    window.devicePixelRatio || 1;


  canvas.width =
    rect.width * dpr;


  canvas.height =
    rect.height * dpr;


  const ctx =
    canvas.getContext("2d");


  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );


  const width =
    rect.width;

  const height =
    rect.height;


  ctx.clearRect(
    0,
    0,
    width,
    height
  );


  const data =
    getGraphData();


  if (!data.length) {
    return;
  }


  /*
    Dynamic scale
  */

  let maxAbs =
    Math.max(
      200,
      ...data.map(
        item =>
          Math.abs(item.cp)
      )
    );


  maxAbs =
    Math.min(
      1000,
      Math.ceil(
        maxAbs / 100
      ) * 100
    );


  /*
    Grid
  */

  ctx.lineWidth = 1;

  ctx.strokeStyle =
    "rgba(255,255,255,.055)";


  for (
    let i = 1;
    i < 5;
    i++
  ) {

    const y =
      (height / 5) * i;


    ctx.beginPath();

    ctx.moveTo(
      0,
      y
    );

    ctx.lineTo(
      width,
      y
    );

    ctx.stroke();

  }


  /*
    Center line
  */

  ctx.strokeStyle =
    "rgba(255,255,255,.17)";


  ctx.beginPath();

  ctx.moveTo(
    0,
    height / 2
  );

  ctx.lineTo(
    width,
    height / 2
  );

  ctx.stroke();


  /*
    Points
  */

  const points =
    data.map(
      (item, index) => {

        const x =
          index /
          Math.max(
            1,
            data.length - 1
          ) *
          width;


        const y =
          height / 2 -
          (
            item.cp /
            maxAbs
          ) *
          (
            height * .42
          );


        return {
          ...item,
          x,
          y
        };

      }
    );


  /*
    Fill
  */

  ctx.beginPath();

  ctx.moveTo(
    points[0].x,
    height / 2
  );


  points.forEach(
    point =>
      ctx.lineTo(
        point.x,
        point.y
      )
  );


  ctx.lineTo(
    points[points.length - 1].x,
    height / 2
  );


  ctx.closePath();


  ctx.fillStyle =
    "rgba(57,217,138,.06)";


  ctx.fill();


  /*
    Main line
  */

  ctx.beginPath();


  points.forEach(
    (point, index) => {

      if (index === 0) {

        ctx.moveTo(
          point.x,
          point.y
        );

      } else {

        ctx.lineTo(
          point.x,
          point.y
        );

      }

    }
  );


  ctx.strokeStyle =
    "#39d98a";

  ctx.lineWidth = 2;

  ctx.stroke();


  /*
    Critical markers
  */

  points.forEach(
    point => {

      if (
        ![
          "Mistake",
          "Miss",
          "Blunder"
        ].includes(
          point.classification
        )
      ) {
        return;
      }


      ctx.beginPath();


      ctx.arc(
        point.x,
        point.y,
        point.classification ===
          "Blunder"
          ? 5
          : 3.5,
        0,
        Math.PI * 2
      );


      ctx.fillStyle =
        point.classification ===
          "Blunder"
          ? "#ff5f6d"
          : "#ff9d57";


      ctx.fill();

    }
  );


  /*
    Current position marker
  */

  const current =
    points[currentIndex];


  if (current) {

    ctx.beginPath();

    ctx.arc(
      current.x,
      current.y,
      5,
      0,
      Math.PI * 2
    );


    ctx.fillStyle =
      "#ffffff";

    ctx.fill();


    ctx.beginPath();

    ctx.arc(
      current.x,
      current.y,
      8,
      0,
      Math.PI * 2
    );


    ctx.strokeStyle =
      "rgba(255,255,255,.3)";

    ctx.stroke();

  }


  /*
    Hover marker
  */

  if (
    graphHoverIndex >= 0 &&
    points[graphHoverIndex]
  ) {

    const point =
      points[graphHoverIndex];


    ctx.beginPath();

    ctx.arc(
      point.x,
      point.y,
      5,
      0,
      Math.PI * 2
    );


    ctx.fillStyle =
      "#5d9cff";

    ctx.fill();

  }


  canvas.__graphPoints =
    points;

}


/* =========================================================
   GRAPH HIT DETECTION
========================================================= */

function graphIndexFromMouse(
  event
) {

  const canvas =
    $("evaluationGraph");


  const rect =
    canvas.getBoundingClientRect();


  const x =
    event.clientX -
    rect.left;


  const points =
    canvas.__graphPoints;


  if (!points || !points.length) {
    return -1;
  }


  const ratio =
    Math.max(
      0,
      Math.min(
        1,
        x / rect.width
      )
    );


  return Math.round(
    ratio *
    (points.length - 1)
  );

}


/* =========================================================
   HOVER
========================================================= */

$("evaluationGraph")
  .addEventListener(
    "mousemove",
    event => {

      const index =
        graphIndexFromMouse(
          event
        );


      graphHoverIndex =
        index;


      const points =
        $("evaluationGraph")
          .__graphPoints;


      if (
        !points ||
        !points[index]
      ) {
        return;
      }


      const point =
        points[index];


      const rect =
        $("evaluationGraph")
          .getBoundingClientRect();


      graphTooltip.style.left =
        `${
          rect.left +
          point.x
        }px`;


      graphTooltip.style.top =
        `${
          rect.top +
          point.y -
          72
        }px`;


      graphTooltip
        .querySelector(
          ".graph-tooltip-move"
        )
        .textContent =
        point.ply === 0
          ? "Starting Position"
          : `${point.moveNumber}${
              point.side === "w"
                ? "."
                : "..."
            } ${point.san}`;


      graphTooltip
        .querySelector(
          ".graph-tooltip-eval"
        )
        .textContent =
        graphEval(
          point.cp
        );


      graphTooltip
        .querySelector(
          ".graph-tooltip-class"
        )
        .textContent =
        point.classification;


      graphTooltip.classList.add(
        "visible"
      );


      drawInteractiveGraph();

    }
  );


/* =========================================================
   LEAVE GRAPH
========================================================= */

$("evaluationGraph")
  .addEventListener(
    "mouseleave",
    () => {

      graphHoverIndex =
        -1;


      graphTooltip.classList.remove(
        "visible"
      );


      drawInteractiveGraph();

    }
  );


/* =========================================================
   CLICK GRAPH -> MOVE
========================================================= */

$("evaluationGraph")
  .addEventListener(
    "click",
    event => {

      const index =
        graphIndexFromMouse(
          event
        );


      if (index < 0) {
        return;
      }


      renderPosition(
        index
      );


      /*
        Keep selected point visible.
      */

      drawInteractiveGraph();

    }
  );


/* =========================================================
   PATCH EXISTING GRAPH FUNCTION
========================================================= */

renderGraph = function() {

  drawInteractiveGraph();

};


/* =========================================================
   REDRAW WHEN POSITION CHANGES
========================================================= */

const originalRenderPosition =
  renderPosition;


renderPosition = function(index) {

  originalRenderPosition(
    index
  );


  requestAnimationFrame(
    () => {

      drawInteractiveGraph();

    }
  );

};


/* =========================================================
   GRAPH CSS
========================================================= */

const graphStyle =
document.createElement(
  "style"
);


graphStyle.textContent = `

  #evaluationGraph {
    cursor: crosshair;
  }

  #graphTooltip {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    min-width: 120px;
    padding: 9px 11px;
    border-radius: 9px;
    border: 1px solid rgba(255,255,255,.1);
    background: rgba(10,15,21,.96);
    box-shadow:
      0 12px 35px rgba(0,0,0,.4);
    opacity: 0;
    transform:
      translate(-50%, 5px);
    transition:
      opacity .12s ease,
      transform .12s ease;
  }

  #graphTooltip.visible {
    opacity: 1;
    transform:
      translate(-50%, 0);
  }

  .graph-tooltip-move {
    color: #aeb9c6;
    font-size: 9px;
    font-weight: 700;
  }

  .graph-tooltip-eval {
    color: #39d98a;
    font-family: monospace;
    font-size: 16px;
    font-weight: 800;
    margin-top: 3px;
  }

  .graph-tooltip-class {
    color: #657180;
    font-size: 8px;
    margin-top: 2px;
  }

`;


document.head.appendChild(
  graphStyle
);


console.log(
  "%cChess Review Pro: Interactive Graph Patch Loaded",
  "color:#b78cff;font-weight:bold"
);

/* =========================================================
   COACH INSIGHTS PRO PATCH
   Turning Points + Coaching Summary + Improvement Plan
   ========================================================= */

(function () {
  function coachScore(move) {
    const cpl = Number(move.cpl || 0);

    if (cpl <= 8) return "excellent";
    if (cpl <= 25) return "good";
    if (cpl <= 55) return "inaccuracy";
    if (cpl <= 100) return "mistake";
    return "blunder";
  }

  function getCoachReason(move) {
    const cpl = Number(move.cpl || 0);
    const cls = String(move.classification || "").toLowerCase();
    const san = move.san || move.move || "";

    if (cls.includes("blunder") || cpl > 100) {
      return `This move ${san} caused a major evaluation drop. Look for forcing alternatives before committing.`;
    }

    if (cls.includes("mistake") || cpl > 55) {
      return `The move ${san} loses noticeable engine value. Check your opponent's threats and forcing moves first.`;
    }

    if (cls.includes("miss") || cls.includes("inaccuracy") || cpl > 25) {
      return `The move ${san} was playable but missed a stronger continuation. Compare it with the engine's best move.`;
    }

    if (cls.includes("best") || cls.includes("brilliant")) {
      return `Excellent decision with ${san}. You found a strong engine-approved continuation.`;
    }

    return `The move ${san} was reasonable and kept the position under control.`;
  }

  function getTurningPoints() {
    if (!Array.isArray(reviewMoves) || !reviewMoves.length) return [];

    return reviewMoves
      .map((m, i) => ({
        ...m,
        index: i + 1,
        impact: Number(m.cpl || 0)
      }))
      .filter(m => m.impact >= 35)
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 5);
  }

  function getCoachStats() {
    const moves = Array.isArray(reviewMoves) ? reviewMoves : [];

    const stats = {
      total: moves.length,
      blunders: 0,
      mistakes: 0,
      inaccuracies: 0,
      misses: 0,
      good: 0,
      best: 0,
      averageCpl: 0,
      worst: null
    };

    if (!moves.length) return stats;

    let totalCpl = 0;

    moves.forEach(m => {
      const cpl = Number(m.cpl || 0);
      totalCpl += cpl;

      const cls = String(m.classification || "").toLowerCase();

      if (cls.includes("blunder")) stats.blunders++;
      else if (cls.includes("mistake")) stats.mistakes++;
      else if (cls.includes("inaccuracy")) stats.inaccuracies++;
      else if (cls.includes("miss")) stats.misses++;
      else if (cls.includes("best") || cls.includes("brilliant")) stats.best++;
      else if (cls.includes("good") || cls.includes("excellent")) stats.good++;

      if (!stats.worst || cpl > stats.worst.cpl) {
        stats.worst = m;
      }
    });

    stats.averageCpl = totalCpl / moves.length;

    return stats;
  }

  function buildCoachAdvice(stats) {
    const advice = [];

    if (stats.blunders > 0) {
      advice.push({
        icon: "\u{1F6A8}",
        title: "Stop the one-move blunders",
        text: `You made ${stats.blunders} major error${stats.blunders > 1 ? "s" : ""}. Before every move, check checks, captures and threats.`
      });
    }

    if (stats.mistakes + stats.inaccuracies > 0) {
      advice.push({
        icon: "\u{1F3AF}",
        title: "Improve candidate-move selection",
        text: `You had ${stats.mistakes + stats.inaccuracies} move${stats.mistakes + stats.inaccuracies > 1 ? "s" : ""} where a stronger continuation was available. Compare 2${String.fromCodePoint(0x2013)}3 candidate moves before playing.`
      });
    }

    if (stats.misses > 0) {
      advice.push({
        icon: "\u{1F440}",
        title: "Look for tactical opportunities",
        text: `You missed ${stats.misses} important opportunities. Scan forcing moves before quiet moves.`
      });
    }

    if (stats.averageCpl <= 20) {
      advice.push({
        icon: "\u{1F525}",
        title: "Strong consistency",
        text: "Your average centipawn loss is low. Focus now on converting advantages and finding tactical improvements."
      });
    } else if (stats.averageCpl <= 50) {
      advice.push({
        icon: "\u{1F4C8}",
        title: "Solid game, room to improve",
        text: "Your decisions were generally playable, but several positions offered stronger engine moves."
      });
    } else {
      advice.push({
        icon: "\u{1F9E0}",
        title: "Slow down in critical positions",
        text: "The biggest gains will come from calculating forcing moves and checking your opponent's threats before moving."
      });
    }

    return advice.slice(0, 3);
  }

  function renderCoachInsights() {
    const old = document.getElementById("coachInsights");
    if (old) old.remove();

    const container = document.querySelector("#reviewSection");
    if (!container) return;

    const stats = getCoachStats();
    const turningPoints = getTurningPoints();
    const advice = buildCoachAdvice(stats);

    const section = document.createElement("section");
    section.id = "coachInsights";
    section.className = "coach-insights";

    const playerName =
      currentPlayerColor === "black"
        ? (blackName?.textContent || "Black")
        : (whiteName?.textContent || "White");

    section.innerHTML = `
      <div class="coach-header">
        <div>
          <div class="coach-eyebrow">AI COACH</div>
          <h2>${playerName}'s Game Diagnosis</h2>
          <p>What mattered most in this game ${String.fromCodePoint(0x2014)} and what to improve next.</p>
        </div>
        <div class="coach-score">
          <span>AVG CPL</span>
          <strong>${stats.averageCpl.toFixed(1)}</strong>
        </div>
      </div>

      <div class="coach-grid">
        ${advice.map(a => `
          <div class="coach-card">
            <div class="coach-icon">${a.icon}</div>
            <div>
              <h3>${a.title}</h3>
              <p>${a.text}</p>
            </div>
          </div>
        `).join("")}
      </div>

      <div class="turning-section">
        <div class="turning-title">
          <div>
            <span class="coach-eyebrow">CRITICAL MOMENTS</span>
            <h3>Where the game changed</h3>
          </div>
          <span class="turning-count">${turningPoints.length} key positions</span>
        </div>

        <div class="turning-list">
          ${
            turningPoints.length
              ? turningPoints.map(m => `
                <button class="turning-point" data-move-index="${m.index}">
                  <div class="turning-move">
                    <span class="turning-number">${m.index}</span>
                    <strong>${m.san || m.move || "?"}</strong>
                  </div>

                  <div class="turning-info">
                    <span class="turning-class ${coachScore(m)}">
                      ${m.classification || "Critical"}
                    </span>
                    <span class="turning-cpl">${String.fromCodePoint(0x2212)}${m.cpl} CPL</span>
                  </div>

                  <p>${getCoachReason(m)}</p>
                </button>
              `).join("")
              : `
                <div class="no-turning">
                  <span>${String.fromCodePoint(0x2705)}</span>
                  No major turning points detected.
                </div>
              `
          }
        </div>
      </div>
    `;

    const graph = document.getElementById("evaluationGraph");
    if (graph && graph.parentElement) {
      graph.parentElement.after(section);
    } else {
      container.appendChild(section);
    }

    section.querySelectorAll(".turning-point").forEach(btn => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.moveIndex);
        if (typeof renderPosition === "function") {
          renderPosition(index);
        }
        document.getElementById("chessBoard")?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      });
    });
  }

  function injectCoachStyles() {
    if (document.getElementById("coachInsightsStyles")) return;

    const style = document.createElement("style");
    style.id = "coachInsightsStyles";

    style.textContent = `
      .coach-insights {
        margin-top: 24px;
        padding: 26px;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 20px;
        background:
          linear-gradient(145deg,
            rgba(255,255,255,.045),
            rgba(255,255,255,.018));
        box-shadow: 0 18px 50px rgba(0,0,0,.22);
      }

      .coach-header {
        display:flex;
        justify-content:space-between;
        gap:20px;
        align-items:flex-start;
        margin-bottom:22px;
      }

      .coach-eyebrow {
        display:block;
        font-size:10px;
        letter-spacing:1.8px;
        font-weight:800;
        opacity:.55;
        margin-bottom:5px;
      }

      .coach-header h2 {
        margin:0;
        font-size:24px;
        font-weight:800;
      }

      .coach-header p {
        margin:7px 0 0;
        opacity:.6;
        font-size:13px;
      }

      .coach-score {
        min-width:90px;
        padding:12px 15px;
        border-radius:14px;
        text-align:center;
        background:rgba(255,255,255,.05);
        border:1px solid rgba(255,255,255,.08);
      }

      .coach-score span {
        display:block;
        font-size:9px;
        letter-spacing:1.5px;
        opacity:.55;
      }

      .coach-score strong {
        display:block;
        font-size:24px;
        margin-top:2px;
      }

      .coach-grid {
        display:grid;
        grid-template-columns:repeat(3,1fr);
        gap:12px;
      }

      .coach-card {
        display:flex;
        gap:13px;
        padding:16px;
        border-radius:15px;
        background:rgba(255,255,255,.035);
        border:1px solid rgba(255,255,255,.06);
      }

      .coach-icon {
        font-size:23px;
        line-height:1;
      }

      .coach-card h3 {
        margin:0 0 6px;
        font-size:14px;
      }

      .coach-card p {
        margin:0;
        font-size:12px;
        line-height:1.55;
        opacity:.65;
      }

      .turning-section {
        margin-top:25px;
      }

      .turning-title {
        display:flex;
        justify-content:space-between;
        align-items:center;
        margin-bottom:12px;
      }

      .turning-title h3 {
        margin:0;
        font-size:17px;
      }

      .turning-count {
        font-size:11px;
        opacity:.5;
      }

      .turning-list {
        display:flex;
        flex-direction:column;
        gap:8px;
      }

      .turning-point {
        width:100%;
        text-align:left;
        padding:14px 16px;
        border-radius:14px;
        border:1px solid rgba(255,255,255,.06);
        background:rgba(255,255,255,.025);
        color:inherit;
        cursor:pointer;
        transition:.18s ease;
      }

      .turning-point:hover {
        background:rgba(255,255,255,.065);
        border-color:rgba(255,255,255,.13);
        transform:translateY(-1px);
      }

      .turning-move {
        display:flex;
        align-items:center;
        gap:10px;
      }

      .turning-number {
        width:28px;
        height:28px;
        display:grid;
        place-items:center;
        border-radius:8px;
        background:rgba(255,255,255,.07);
        font-size:11px;
        opacity:.7;
      }

      .turning-move strong {
        font-size:14px;
      }

      .turning-info {
        display:flex;
        gap:8px;
        align-items:center;
        margin:7px 0 4px 38px;
      }

      .turning-class {
        font-size:10px;
        font-weight:800;
        text-transform:uppercase;
        letter-spacing:.5px;
      }

      .turning-class.blunder { color:#ff6b6b; }
      .turning-class.mistake { color:#ffad5c; }
      .turning-class.inaccuracy { color:#ffd166; }
      .turning-class.miss { color:#c5a3ff; }
      .turning-class.good,
      .turning-class.excellent,
      .turning-class.best { color:#5ee39a; }

      .turning-cpl {
        font-size:10px;
        opacity:.45;
      }

      .turning-point p {
        margin:5px 0 0 38px;
        font-size:11px;
        line-height:1.5;
        opacity:.58;
      }

      .no-turning {
        padding:20px;
        border-radius:14px;
        background:rgba(90,220,140,.05);
        border:1px solid rgba(90,220,140,.1);
        font-size:13px;
      }

      @media(max-width:850px) {
        .coach-grid {
          grid-template-columns:1fr;
        }

        .coach-header {
          flex-direction:column;
        }

        .coach-score {
          align-self:flex-start;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectCoachStyles();

  const originalStartReview = startReview;

  startReview = async function () {
    await originalStartReview.apply(this, arguments);

    setTimeout(() => {
      renderCoachInsights();
    }, 250);
  };

  console.log("Chess Review Pro: Coach Insights Pro Patch Loaded");
})();
/* =========================================================
   RETRY MISTAKES PRO
   Interactive practice from critical positions
   ========================================================= */

(function () {
  function getRetryMoves() {
    if (!Array.isArray(reviewMoves)) return [];

    return reviewMoves
      .map((m, i) => ({ ...m, reviewIndex: i + 1 }))
      .filter(m => {
        const cpl = Number(m.cpl || 0);
        const cls = String(m.classification || "").toLowerCase();

        return (
          cpl >= 45 ||
          cls.includes("mistake") ||
          cls.includes("blunder") ||
          cls.includes("miss")
        );
      })
      .sort((a, b) => Number(b.cpl || 0) - Number(a.cpl || 0))
      .slice(0, 8);
  }

  function getFenBeforeMove(index) {
    if (!Array.isArray(reviewMoves) || !reviewMoves[index - 1]) return null;
    return reviewMoves[index - 1].fenBefore || reviewMoves[index - 1].beforeFen || null;
  }

  function getPlayedMove(move) {
    return move.uci || move.bestmovePlayed || move.move || "";
  }

  function startRetry(index) {
    const move = reviewMoves[index - 1];
    if (!move) return;

    const fen = move.fenBefore || move.beforeFen;
    if (!fen) {
      alert("Position data is unavailable for this move.");
      return;
    }

    window.retryState = {
      active: true,
      reviewIndex: index,
      expectedBest: move.bestmove || move.bestMove || "",
      playedMove: getPlayedMove(move),
      originalMove: move.san || move.move || "",
      fen,
      submitted: false
    };

    renderRetryBoard(fen, move);
  }

  function renderRetryBoard(fen, move) {
    const modal = document.getElementById("retryModal");
    if (!modal) return;

    const title = document.getElementById("retryTitle");
    const info = document.getElementById("retryInfo");
    const result = document.getElementById("retryResult");

    title.textContent = "Find the Better Move";
    info.innerHTML = `
      <strong>Critical position</strong>
      <span>
        Your original move was
        <b>${move.san || move.move || "unknown"}</b>.
        Can you find something stronger?
      </span>
    `;

    result.innerHTML = "";

    modal.classList.add("open");

    window.retryChess = new Chess(fen);

    renderRetryChessBoard();
  }

  function renderRetryChessBoard() {
    const board = document.getElementById("retryBoard");
    if (!board || !window.retryChess) return;

    board.innerHTML = "";

    const chess = window.retryChess;
    const orientation =
      chess.turn() === "w" ? "white" : "black";

    const files = ["a","b","c","d","e","f","g","h"];
    const ranks = [8,7,6,5,4,3,2,1];

    const orderedFiles =
      orientation === "white" ? files : [...files].reverse();

    const orderedRanks =
      orientation === "white" ? ranks : [...ranks].reverse();

    orderedRanks.forEach((rank, r) => {
      orderedFiles.forEach((file, c) => {
        const square = file + rank;
        const piece = chess.get(square);

        const cell = document.createElement("button");
        cell.className = "retry-square";
        cell.dataset.square = square;

        if ((r + c) % 2 === 0) {
          cell.classList.add("light");
        } else {
          cell.classList.add("dark");
        }

        if (piece) {
          cell.innerHTML = `
            <span class="retry-piece">
              ${pieceGlyph(piece)}
            </span>
          `;
        }

        cell.addEventListener("click", () => {
          handleRetrySquare(square);
        });

        board.appendChild(cell);
      });
    });
  }

  function pieceGlyph(piece) {
    const glyphs = {
      w: {
        p: String.fromCodePoint(0x2659),
        r: String.fromCodePoint(0x2656),
        n: String.fromCodePoint(0x2658),
        b: String.fromCodePoint(0x2657),
        q: String.fromCodePoint(0x2655),
        k: String.fromCodePoint(0x2654)
      },
      b: {
        p: String.fromCodePoint(0x265F),
        r: String.fromCodePoint(0x265C),
        n: String.fromCodePoint(0x265E),
        b: String.fromCodePoint(0x265D),
        q: String.fromCodePoint(0x265B),
        k: String.fromCodePoint(0x265A)
      }
    };

    return glyphs[piece.color]?.[piece.type] || "";
  }

  let retrySelected = null;

  function handleRetrySquare(square) {
    if (!window.retryChess || window.retryState?.submitted) return;

    const piece = window.retryChess.get(square);

    if (!retrySelected) {
      if (!piece || piece.color !== window.retryChess.turn()) return;

      retrySelected = square;

      document.querySelectorAll(".retry-square").forEach(s => {
        s.classList.remove("selected");
      });

      document
        .querySelector(`[data-square="${square}"]`)
        ?.classList.add("selected");

      return;
    }

    const from = retrySelected;
    const to = square;

    let result;

    try {
      result = window.retryChess.move({
        from,
        to,
        promotion: "q"
      });
    } catch {
      result = null;
    }

    retrySelected = null;

    if (!result) {
      document.querySelectorAll(".retry-square").forEach(s => {
        s.classList.remove("selected");
      });
      return;
    }

    renderRetryChessBoard();

    evaluateRetryMove(result);
  }

  function normalizeUci(value) {
    if (!value) return "";

    return String(value)
      .trim()
      .toLowerCase()
      .replace(/[+#]/g, "");
  }

  function evaluateRetryMove(result) {
    const state = window.retryState;
    if (!state) return;

    state.submitted = true;

    const played = normalizeUci(
      result.from + result.to +
      (result.promotion || "")
    );

    const best = normalizeUci(state.expectedBest);

    const resultBox = document.getElementById("retryResult");

    if (played === best) {
      resultBox.innerHTML = `
        <div class="retry-success">
          <div class="retry-result-icon">${String.fromCodePoint(0x1F525)}</div>
          <div>
            <strong>Best move!</strong>
            <p>You found the engine's top continuation.</p>
          </div>
        </div>
      `;
      return;
    }

    const currentMove = reviewMoves[state.reviewIndex - 1];

    resultBox.innerHTML = `
      <div class="retry-fail">
        <div class="retry-result-icon">${String.fromCodePoint(0x1F4A1)}</div>
        <div>
          <strong>Not the best move</strong>
          <p>
            Engine suggestion:
            <b>${state.expectedBest || "Calculate further"}</b>
          </p>
          ${
            currentMove?.explanation
              ? `<small>${currentMove.explanation}</small>`
              : ""
          }
        </div>
      </div>

      <button class="retry-show-best" id="retryShowBest">
        Show Best Line
      </button>
    `;

    document
      .getElementById("retryShowBest")
      ?.addEventListener("click", () => {
        if (typeof renderPosition === "function") {
          renderPosition(state.reviewIndex - 1);
        }

        closeRetryModal();
      });
  }

  function closeRetryModal() {
    document.getElementById("retryModal")?.classList.remove("open");
    retrySelected = null;

    if (window.retryState) {
      window.retryState.active = false;
    }
  }

  function createRetryUI() {
    if (document.getElementById("retryModal")) return;

    const modal = document.createElement("div");
    modal.id = "retryModal";

    modal.innerHTML = `
      <div class="retry-backdrop"></div>

      <div class="retry-dialog">

        <div class="retry-top">
          <div>
            <span class="retry-eyebrow">PRACTICE MODE</span>
            <h2 id="retryTitle">Find the Better Move</h2>
          </div>

          <button id="retryClose">Ã—</button>
        </div>

        <div id="retryInfo" class="retry-info"></div>

        <div class="retry-board-wrap">
          <div id="retryBoard" class="retry-board"></div>
        </div>

        <div id="retryResult"></div>

      </div>
    `;

    document.body.appendChild(modal);

    document
      .getElementById("retryClose")
      ?.addEventListener("click", closeRetryModal);

    modal
      .querySelector(".retry-backdrop")
      ?.addEventListener("click", closeRetryModal);
  }

  function renderRetrySection() {
    const old = document.getElementById("retrySection");
    if (old) old.remove();

    const container = document.querySelector("#reviewSection");
    if (!container) return;

    const retryMoves = getRetryMoves();

    const section = document.createElement("section");
    section.id = "retrySection";
    section.className = "retry-section";

    section.innerHTML = `
      <div class="retry-section-head">
        <div>
          <span class="retry-eyebrow">TRAINING MODE</span>
          <h2>Retry Your Mistakes</h2>
          <p>
            Don't just see the mistake ${String.fromCodePoint(0x2014)} find the better move yourself.
          </p>
        </div>

        <div class="retry-badge">
          ${retryMoves.length} positions
        </div>
      </div>

      ${
        retryMoves.length
          ? `
            <div class="retry-cards">
              ${retryMoves.map((m, i) => `
                <button
                  class="retry-card"
                  data-retry-index="${m.reviewIndex}"
                >
                  <div class="retry-card-number">
                    ${i + 1}
                  </div>

                  <div class="retry-card-main">
                    <strong>
                      ${m.san || m.move || "Critical move"}
                    </strong>

                    <span>
                      ${m.classification || "Critical"}
                      ${String.fromCodePoint(0x00B7)} ${String.fromCodePoint(0x2212)}${m.cpl || 0} CPL
                    </span>
                  </div>

                  <div class="retry-play">
                    ${String.fromCodePoint(0x25B6)}
                  </div>
                </button>
              `).join("")}
            </div>
          `
          : `
            <div class="retry-empty">
              ${String.fromCodePoint(0x1F389)} No critical positions found.
              This game doesn't need retry practice.
            </div>
          `
      }
    `;

    const coach = document.getElementById("coachInsights");

    if (coach) {
      coach.after(section);
    } else {
      container.appendChild(section);
    }

    section.querySelectorAll(".retry-card").forEach(card => {
      card.addEventListener("click", () => {
        startRetry(Number(card.dataset.retryIndex));
      });
    });
  }

  function injectRetryStyles() {
    if (document.getElementById("retryStyles")) return;

    const style = document.createElement("style");
    style.id = "retryStyles";

    style.textContent = `
      #retryModal {
        position:fixed;
        inset:0;
        z-index:99999;
        display:none;
      }

      #retryModal.open {
        display:flex;
        align-items:center;
        justify-content:center;
      }

      .retry-backdrop {
        position:absolute;
        inset:0;
        background:rgba(0,0,0,.78);
        backdrop-filter:blur(8px);
      }

      .retry-dialog {
        position:relative;
        width:min(680px,94vw);
        max-height:94vh;
        overflow:auto;
        padding:24px;
        border-radius:22px;
        background:#15171b;
        border:1px solid rgba(255,255,255,.1);
        box-shadow:0 30px 100px rgba(0,0,0,.55);
      }

      .retry-top {
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        margin-bottom:15px;
      }

      .retry-eyebrow {
        font-size:10px;
        letter-spacing:1.7px;
        font-weight:800;
        opacity:.5;
      }

      .retry-top h2 {
        margin:4px 0 0;
        font-size:22px;
      }

      #retryClose {
        width:34px;
        height:34px;
        border:0;
        border-radius:10px;
        background:rgba(255,255,255,.07);
        color:inherit;
        font-size:23px;
        cursor:pointer;
      }

      .retry-info {
        padding:13px 15px;
        border-radius:13px;
        background:rgba(255,255,255,.045);
        border:1px solid rgba(255,255,255,.07);
        margin-bottom:16px;
      }

      .retry-info strong {
        display:block;
        font-size:13px;
        margin-bottom:4px;
      }

      .retry-info span {
        font-size:12px;
        opacity:.65;
      }

      .retry-board-wrap {
        width:min(540px,100%);
        margin:auto;
      }

      .retry-board {
        width:100%;
        aspect-ratio:1;
        display:grid;
        grid-template-columns:repeat(8,1fr);
        overflow:hidden;
        border-radius:10px;
        box-shadow:0 12px 35px rgba(0,0,0,.4);
      }

      .retry-square {
        position:relative;
        border:0;
        padding:0;
        display:grid;
        place-items:center;
        cursor:pointer;
        font-family:serif;
      }

      .retry-square.light {
        background:#e8edf0;
      }

      .retry-square.dark {
        background:#76919f;
      }

      .retry-square.selected {
        box-shadow:inset 0 0 0 4px #f5c84b;
        z-index:2;
      }

      .retry-piece {
        font-size:clamp(28px,6vw,52px);
        line-height:1;
        user-select:none;
        filter:drop-shadow(0 2px 1px rgba(0,0,0,.35));
      }

      .retry-section {
        margin-top:24px;
        padding:25px;
        border-radius:20px;
        background:rgba(255,255,255,.025);
        border:1px solid rgba(255,255,255,.07);
      }

      .retry-section-head {
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:15px;
        margin-bottom:16px;
      }

      .retry-section-head h2 {
        margin:4px 0;
        font-size:21px;
      }

      .retry-section-head p {
        margin:5px 0 0;
        font-size:12px;
        opacity:.55;
      }

      .retry-badge {
        padding:7px 11px;
        border-radius:20px;
        background:rgba(255,255,255,.06);
        font-size:10px;
        opacity:.7;
      }

      .retry-cards {
        display:grid;
        grid-template-columns:repeat(2,1fr);
        gap:9px;
      }

      .retry-card {
        display:flex;
        align-items:center;
        gap:12px;
        width:100%;
        padding:13px;
        border-radius:13px;
        border:1px solid rgba(255,255,255,.06);
        background:rgba(255,255,255,.025);
        color:inherit;
        text-align:left;
        cursor:pointer;
        transition:.18s ease;
      }

      .retry-card:hover {
        background:rgba(255,255,255,.07);
        transform:translateY(-1px);
      }

      .retry-card-number {
        width:28px;
        height:28px;
        display:grid;
        place-items:center;
        border-radius:8px;
        background:rgba(255,255,255,.07);
        font-size:11px;
      }

      .retry-card-main {
        flex:1;
      }

      .retry-card-main strong {
        display:block;
        font-size:13px;
      }

      .retry-card-main span {
        display:block;
        margin-top:4px;
        font-size:10px;
        opacity:.5;
      }

      .retry-play {
        font-size:13px;
        opacity:.45;
      }

      .retry-success,
      .retry-fail {
        display:flex;
        gap:13px;
        margin-top:15px;
        padding:15px;
        border-radius:14px;
      }

      .retry-success {
        background:rgba(70,220,140,.08);
        border:1px solid rgba(70,220,140,.18);
      }

      .retry-fail {
        background:rgba(255,180,70,.07);
        border:1px solid rgba(255,180,70,.14);
      }

      .retry-result-icon {
        font-size:24px;
      }

      .retry-success strong,
      .retry-fail strong {
        font-size:14px;
      }

      .retry-success p,
      .retry-fail p {
        margin:4px 0;
        font-size:12px;
        opacity:.65;
      }

      .retry-fail small {
        display:block;
        margin-top:6px;
        opacity:.55;
        line-height:1.45;
      }

      .retry-show-best {
        margin-top:10px;
        padding:10px 14px;
        border:0;
        border-radius:10px;
        background:rgba(255,255,255,.09);
        color:inherit;
        cursor:pointer;
      }

      .retry-empty {
        padding:18px;
        border-radius:13px;
        background:rgba(80,220,140,.05);
        border:1px solid rgba(80,220,140,.1);
        font-size:12px;
      }

      @media(max-width:650px) {
        .retry-cards {
          grid-template-columns:1fr;
        }

        .retry-dialog {
          padding:16px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  createRetryUI();
  injectRetryStyles();

  const originalCoachRender =
    typeof renderCoachInsights === "function"
      ? renderCoachInsights
      : null;

  if (originalCoachRender) {
    renderCoachInsights = function () {
      originalCoachRender.apply(this, arguments);
      setTimeout(renderRetrySection, 50);
    };
  }

  console.log("Chess Review Pro: Retry Mistakes Pro Patch Loaded");
})();
/* =========================================================
   PRINCIPAL VARIATION / BEST LINE PRO
   Shows engine continuation from the current position
   ========================================================= */

(function () {
  let pvWorker = null;
  let pvBusy = false;

  function getPVWorker() {
    if (pvWorker) return pvWorker;

    pvWorker = new Worker(STOCKFISH_PATH);

    pvWorker.postMessage("uci");
    pvWorker.postMessage("setoption name Threads value 1");
    pvWorker.postMessage("setoption name Hash value 64");

    return pvWorker;
  }

  function closePVWorker() {
    if (pvWorker) {
      try {
        pvWorker.terminate();
      } catch {}
      pvWorker = null;
    }
    pvBusy = false;
  }

  function parsePV(info) {
    const match = info.match(/\bpv\s+(.+)$/i);
    if (!match) return [];

    return match[1]
      .trim()
      .split(/\s+/)
      .filter(x => /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(x));
  }

  function uciToSANLine(fen, pv) {
    let chess;

    try {
      chess = new Chess(fen);
    } catch {
      return [];
    }

    const result = [];

    for (const uci of pv) {
      try {
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        const promotion = uci[4];

        const move = chess.move({
          from,
          to,
          ...(promotion ? { promotion } : {})
        });

        if (!move) break;

        result.push({
          san: move.san,
          uci
        });
      } catch {
        break;
      }
    }

    return result;
  }

  function formatPVLine(line) {
    if (!line.length) return "No principal variation available.";

    let output = "";

    line.forEach((move, i) => {
      if (i % 2 === 0) {
        output += `${Math.floor(i / 2) + 1}. ${move.san} `;
      } else {
        output += `${move.san} `;
      }
    });

    return output.trim();
  }

  function currentAnalysisFen() {
    if (
      typeof currentPositionIndex !== "undefined" &&
      Array.isArray(reviewMoves)
    ) {
      const move = reviewMoves[currentPositionIndex - 1];

      if (currentPositionIndex === 0 && typeof initialFen !== "undefined") {
        return initialFen;
      }

      if (move?.fenAfter) return move.fenAfter;
      if (move?.fen) return move.fen;
      if (move?.afterFen) return move.afterFen;
    }

    if (typeof game !== "undefined" && game?.fen) {
      return game.fen();
    }

    return null;
  }

  function showPVPanel() {
    const old = document.getElementById("pvPanel");
    if (old) old.remove();

    const anchor =
      document.getElementById("coachInsights") ||
      document.getElementById("retrySection") ||
      document.getElementById("evaluationGraph");

    if (!anchor) return null;

    const panel = document.createElement("section");
    panel.id = "pvPanel";
    panel.className = "pv-panel";

    panel.innerHTML = `
      <div class="pv-header">
        <div>
          <span class="pv-eyebrow">ENGINE CONTINUATION</span>
          <h2>Best Line Explorer</h2>
          <p>See how Stockfish expects the position to develop.</p>
        </div>

        <div class="pv-depth">
          <span>DEPTH</span>
          <strong id="pvDepth">String.fromCodePoint(0x2014)”</strong>
        </div>
      </div>

      <div class="pv-eval-row">
        <span id="pvEval">Analyzing position ${String.fromCodePoint(0x2014)}</span>
      </div>

      <div class="pv-line" id="pvLine">
        <div class="pv-loading">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <div class="pv-actions">
        <button id="pvCopy">Copy Line</button>
        <button id="pvRefresh">Analyze Again</button>
      </div>
    `;

    anchor.after(panel);

    document
      .getElementById("pvRefresh")
      ?.addEventListener("click", () => analyzePV());

    document
      .getElementById("pvCopy")
      ?.addEventListener("click", async () => {
        const text =
          document.getElementById("pvLine")?.dataset?.line || "";

        if (!text) return;

        try {
          await navigator.clipboard.writeText(text);

          const btn = document.getElementById("pvCopy");
          if (btn) {
            const oldText = btn.textContent;
            btn.textContent = "Copied " + String.fromCodePoint(0x2713)

            setTimeout(() => {
              btn.textContent = oldText;
            }, 1200);
          }
        } catch {}
      });

    return panel;
  }

  function renderPV(pv, evalText, depth, fen) {
    const lineBox = document.getElementById("pvLine");
    const evalBox = document.getElementById("pvEval");
    const depthBox = document.getElementById("pvDepth");

    if (!lineBox) return;

    const line = uciToSANLine(fen, pv);

    const formatted = formatPVLine(line);

    lineBox.dataset.line = formatted;

    lineBox.innerHTML = line.length
      ? line.map((m, i) => `
          <span class="pv-move ${i === 0 ? "pv-best" : ""}">
            ${i % 2 === 0 ? `<small>${Math.floor(i / 2) + 1}.</small>` : ""}
            ${m.san}
          </span>
        `).join("")
      : `<span class="pv-empty">No line found.</span>`;

    if (evalBox) {
      evalBox.innerHTML = `
        <span class="pv-eval-label">EVALUATION</span>
        <strong>${evalText}</strong>
      `;
    }

    if (depthBox) {
      depthBox.textContent = depth || String.fromCodePoint(0x2014);
    }
  }

  function analyzePV() {
    if (pvBusy) return;

    const fen = currentAnalysisFen();

    if (!fen) {
      const box = document.getElementById("pvLine");
      if (box) {
        box.innerHTML =
          `<span class="pv-empty">Position unavailable.</span>`;
      }
      return;
    }

    pvBusy = true;

    const worker = getPVWorker();

    let latestPV = [];
    let latestScore = "0.00";
    let latestDepth = 0;

    worker.onmessage = event => {
      const line = String(event.data || "");

      if (line.startsWith("info ")) {
        const depthMatch = line.match(/\bdepth\s+(\d+)/);
        const scoreMatch =
          line.match(/\bscore\s+cp\s+(-?\d+)/) ||
          line.match(/\bscore\s+mate\s+(-?\d+)/);

        const pv = parsePV(line);

        if (depthMatch) {
          latestDepth = Number(depthMatch[1]);
        }

        if (scoreMatch) {
          if (line.includes("score mate")) {
            latestScore = `M${scoreMatch[1]}`;
          } else {
            const cp = Number(scoreMatch[1]);

            latestScore =
              `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
          }
        }

        if (pv.length) {
          latestPV = pv;
        }

        if (latestPV.length) {
          renderPV(
            latestPV,
            latestScore,
            latestDepth,
            fen
          );
        }
      }

      if (line === "bestmove (none)" || line.startsWith("bestmove ")) {
        if (latestPV.length) {
          renderPV(
            latestPV,
            latestScore,
            latestDepth,
            fen
          );
        }

        pvBusy = false;
      }
    };

    worker.postMessage("stop");
    worker.postMessage("ucinewgame");
    worker.postMessage(`position fen ${fen}`);

    const depth =
      typeof depthSelect !== "undefined" && depthSelect?.value
        ? Number(depthSelect.value)
        : 18;

    worker.postMessage(`go depth ${Math.min(depth, 22)}`);
  }

  function createPV() {
    showPVPanel();

    setTimeout(() => {
      analyzePV();
    }, 100);
  }

  function injectPVStyles() {
    if (document.getElementById("pvStyles")) return;

    const style = document.createElement("style");
    style.id = "pvStyles";

    style.textContent = `
      .pv-panel {
        margin-top:24px;
        padding:25px;
        border-radius:20px;
        border:1px solid rgba(255,255,255,.07);
        background:
          linear-gradient(
            145deg,
            rgba(255,255,255,.04),
            rgba(255,255,255,.018)
          );
      }

      .pv-header {
        display:flex;
        justify-content:space-between;
        gap:18px;
        align-items:flex-start;
      }

      .pv-eyebrow {
        display:block;
        font-size:10px;
        font-weight:800;
        letter-spacing:1.7px;
        opacity:.48;
      }

      .pv-header h2 {
        margin:4px 0;
        font-size:21px;
      }

      .pv-header p {
        margin:4px 0 0;
        font-size:12px;
        opacity:.55;
      }

      .pv-depth {
        min-width:70px;
        text-align:center;
        padding:9px 12px;
        border-radius:12px;
        background:rgba(255,255,255,.05);
      }

      .pv-depth span {
        display:block;
        font-size:8px;
        letter-spacing:1.4px;
        opacity:.45;
      }

      .pv-depth strong {
        display:block;
        margin-top:2px;
        font-size:16px;
      }

      .pv-eval-row {
        margin-top:18px;
        padding:12px 14px;
        border-radius:12px;
        background:rgba(255,255,255,.035);
        border:1px solid rgba(255,255,255,.05);
      }

      .pv-eval-label {
        margin-right:9px;
        font-size:9px;
        letter-spacing:1.2px;
        opacity:.45;
      }

      .pv-eval-row strong {
        font-size:14px;
      }

      .pv-line {
        min-height:60px;
        display:flex;
        align-items:center;
        flex-wrap:wrap;
        gap:7px;
        margin-top:12px;
        padding:15px;
        border-radius:13px;
        background:rgba(0,0,0,.18);
        border:1px solid rgba(255,255,255,.05);
        font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
      }

      .pv-move {
        padding:7px 9px;
        border-radius:7px;
        background:rgba(255,255,255,.045);
        font-size:13px;
      }

      .pv-move small {
        margin-right:3px;
        opacity:.4;
      }

      .pv-move.pv-best {
        background:rgba(80,220,145,.13);
        border:1px solid rgba(80,220,145,.18);
      }

      .pv-empty {
        font-size:12px;
        opacity:.5;
      }

      .pv-loading {
        display:flex;
        gap:5px;
      }

      .pv-loading span {
        width:7px;
        height:7px;
        border-radius:50%;
        background:currentColor;
        opacity:.35;
        animation:pvPulse 1s infinite ease-in-out;
      }

      .pv-loading span:nth-child(2) {
        animation-delay:.15s;
      }

      .pv-loading span:nth-child(3) {
        animation-delay:.3s;
      }

      @keyframes pvPulse {
        0%,100% {
          transform:translateY(0);
          opacity:.25;
        }
        50% {
          transform:translateY(-4px);
          opacity:.8;
        }
      }

      .pv-actions {
        display:flex;
        gap:8px;
        margin-top:12px;
      }

      .pv-actions button {
        padding:9px 13px;
        border:1px solid rgba(255,255,255,.08);
        border-radius:9px;
        background:rgba(255,255,255,.045);
        color:inherit;
        cursor:pointer;
        font-size:11px;
      }

      .pv-actions button:hover {
        background:rgba(255,255,255,.09);
      }

      @media(max-width:650px) {
        .pv-header {
          flex-direction:column;
        }

        .pv-depth {
          align-self:flex-start;
        }

        .pv-move {
          font-size:12px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectPVStyles();

  const previousRetryStart =
    typeof startRetry === "function"
      ? startRetry
      : null;

  if (previousRetryStart) {
    const oldStartRetry = startRetry;

    startRetry = function () {
      oldStartRetry.apply(this, arguments);

      setTimeout(() => {
        const moveIndex = arguments[0];

        if (
          Number.isFinite(Number(moveIndex)) &&
          reviewMoves?.[Number(moveIndex) - 1]
        ) {
          const move = reviewMoves[Number(moveIndex) - 1];

          showPVPanel();

          setTimeout(() => {
            const fen =
              move.fenBefore ||
              move.beforeFen;

            if (fen) analyzePV();
          }, 200);
        }
      }, 150);
    };
  }

  const previousRenderPosition =
    renderPosition;

  renderPosition = function (index) {
    previousRenderPosition.apply(this, arguments);

    setTimeout(() => {
      createPV();
    }, 120);
  };

  console.log(
    "Chess Review Pro: Principal Variation Pro Patch Loaded"
  );
})();
/* =========================================================
   MATERIAL SWING + TACTICAL DASHBOARD PRO
   ========================================================= */

(function () {
  const PIECE_VALUES = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
    k: 0
  };

  function materialFromFen(fen) {
    if (!fen) return { white: 0, black: 0 };

    const board = fen.split(" ")[0];

    let white = 0;
    let black = 0;

    for (const ch of board) {
      const lower = ch.toLowerCase();

      if (!PIECE_VALUES.hasOwnProperty(lower)) continue;

      if (ch === ch.toUpperCase()) {
        white += PIECE_VALUES[lower];
      } else {
        black += PIECE_VALUES[lower];
      }
    }

    return { white, black };
  }

  function materialDifference(fen) {
    const m = materialFromFen(fen);
    return m.white - m.black;
  }

  function getMoveFen(move, type) {
    if (!move) return null;

    if (type === "before") {
      return (
        move.fenBefore ||
        move.beforeFen ||
        null
      );
    }

    return (
      move.fenAfter ||
      move.afterFen ||
      move.fen ||
      null
    );
  }

  function buildMaterialData() {
    if (!Array.isArray(reviewMoves)) return [];

    const data = [];

    reviewMoves.forEach((move, i) => {
      const before = getMoveFen(move, "before");
      const after = getMoveFen(move, "after");

      if (!after) return;

      const material = materialDifference(after);

      data.push({
        index: i + 1,
        material,
        beforeMaterial: before
          ? materialDifference(before)
          : material,
        san: move.san || move.move || "",
        classification: move.classification || "",
        cpl: Number(move.cpl || 0)
      });
    });

    return data;
  }

  function getMaterialEvents(data) {
    return data
      .map((d, i) => ({
        ...d,
        swing: Math.abs(
          d.material - d.beforeMaterial
        )
      }))
      .filter(d => d.swing >= 2)
      .sort((a, b) => b.swing - a.swing)
      .slice(0, 6);
  }

  function getTacticalStats(data) {
    const stats = {
      captures: 0,
      bigSwings: 0,
      sacrifices: 0,
      materialGains: 0,
      materialLosses: 0
    };

    data.forEach(d => {
      if (/x/.test(d.san)) {
        stats.captures++;
      }

      const delta =
        d.material - d.beforeMaterial;

      if (Math.abs(delta) >= 2) {
        stats.bigSwings++;
      }

      if (delta >= 2) {
        stats.materialGains++;
      }

      if (delta <= -2) {
        stats.materialLosses++;
      }
    });

    return stats;
  }

  function materialLabel(value) {
    if (value === 0) return "Equal material";

    return value > 0
      ? `White +${value}`
      : `Black +${Math.abs(value)}`;
  }

  function renderMaterialDashboard() {
    const old =
      document.getElementById("materialDashboard");

    if (old) old.remove();

    const container =
      document.querySelector("#reviewSection");

    if (!container) return;

    const data = buildMaterialData();

    if (!data.length) return;

    const events = getMaterialEvents(data);
    const stats = getTacticalStats(data);

    const finalMaterial =
      data[data.length - 1].material;

    const maxAbs = Math.max(
      1,
      ...data.map(d =>
        Math.abs(d.material)
      )
    );

    const section =
      document.createElement("section");

    section.id = "materialDashboard";
    section.className =
      "material-dashboard";

    section.innerHTML = `
      <div class="material-head">
        <div>
          <span class="material-eyebrow">
            POSITIONAL DATA
          </span>

          <h2>
            Material & Tactical Dashboard
          </h2>

          <p>
            See where material changed and which moments
            created the biggest tactical swings.
          </p>
        </div>

        <div class="material-final">
          <span>FINAL MATERIAL</span>
          <strong>
            ${materialLabel(finalMaterial)}
          </strong>
        </div>
      </div>

      <div class="material-stats">

        <div class="material-stat">
          <span>CAPTURES</span>
          <strong>${stats.captures}</strong>
        </div>

        <div class="material-stat">
          <span>BIG SWINGS</span>
          <strong>${stats.bigSwings}</strong>
        </div>

        <div class="material-stat">
          <span>MATERIAL GAINS</span>
          <strong>${stats.materialGains}</strong>
        </div>

        <div class="material-stat">
          <span>MATERIAL LOSSES</span>
          <strong>${stats.materialLosses}</strong>
        </div>

      </div>

      <div class="material-chart">

        <div class="material-zero"></div>

        <div class="material-bars">
          ${data.map(d => {
            const height =
              Math.max(
                3,
                Math.round(
                  Math.abs(d.material) /
                  maxAbs * 100
                )
              );

            const positive =
              d.material >= 0;

            return `
              <button
                class="
                  material-bar
                  ${positive ? "white-side" : "black-side"}
                  ${d.swing >= 2 ? "material-critical" : ""}
                "
                style="height:${height}%"
                data-material-index="${d.index}"
                title="${d.san} String.fromCodePoint(0x00B7) ${materialLabel(d.material)}"
              ></button>
            `;
          }).join("")}
        </div>

      </div>

      <div class="material-events">

        <div class="material-events-head">
          <div>
            <span class="material-eyebrow">
              TACTICAL SWINGS
            </span>
            <h3>Biggest Material Changes</h3>
          </div>
        </div>

        ${
          events.length
            ? events.map(e => `
              <button
                class="material-event"
                data-material-index="${e.index}"
              >
                <div class="material-event-move">
                  <span>${e.index}</span>
                  <strong>${e.san || "Move"}</strong>
                </div>

                <div class="material-event-center">
                  <span>
                    ${materialLabel(e.material)}
                  </span>

                  <small>
                    Swing ${e.swing >= 0 ? "+" : ""}
                    ${e.material - e.beforeMaterial}
                  </small>
                </div>

                <div class="material-event-arrow">
                  ${String.fromCodePoint(0x2192)}
                </div>
              </button>
            `).join("")
            : `
              <div class="material-empty">
                No major material swings detected.
              </div>
            `
        }

      </div>
    `;

    const pv =
      document.getElementById("pvPanel");

    if (pv) {
      pv.after(section);
    } else {
      container.appendChild(section);
    }

    section
      .querySelectorAll("[data-material-index]")
      .forEach(button => {
        button.addEventListener("click", () => {
          const index =
            Number(
              button.dataset.materialIndex
            );

          if (
            typeof renderPosition ===
            "function"
          ) {
            renderPosition(index);
          }
        });
      });
  }

  function injectMaterialStyles() {
    if (
      document.getElementById(
        "materialDashboardStyles"
      )
    ) return;

    const style =
      document.createElement("style");

    style.id =
      "materialDashboardStyles";

    style.textContent = `
      .material-dashboard {
        margin-top:24px;
        padding:26px;
        border-radius:20px;
        border:1px solid rgba(255,255,255,.07);
        background:
          linear-gradient(
            145deg,
            rgba(255,255,255,.04),
            rgba(255,255,255,.018)
          );
      }

      .material-head {
        display:flex;
        justify-content:space-between;
        gap:20px;
        align-items:flex-start;
      }

      .material-eyebrow {
        display:block;
        font-size:10px;
        font-weight:800;
        letter-spacing:1.7px;
        opacity:.48;
      }

      .material-head h2 {
        margin:4px 0;
        font-size:21px;
      }

      .material-head p {
        margin:5px 0 0;
        max-width:600px;
        font-size:12px;
        line-height:1.5;
        opacity:.55;
      }

      .material-final {
        min-width:120px;
        padding:12px;
        border-radius:13px;
        background:rgba(255,255,255,.05);
        text-align:center;
      }

      .material-final span {
        display:block;
        font-size:8px;
        letter-spacing:1.4px;
        opacity:.45;
      }

      .material-final strong {
        display:block;
        margin-top:4px;
        font-size:12px;
      }

      .material-stats {
        display:grid;
        grid-template-columns:
          repeat(4, 1fr);
        gap:9px;
        margin-top:20px;
      }

      .material-stat {
        padding:14px;
        border-radius:12px;
        background:rgba(255,255,255,.035);
        border:1px solid rgba(255,255,255,.05);
      }

      .material-stat span {
        display:block;
        font-size:8px;
        letter-spacing:1.2px;
        opacity:.43;
      }

      .material-stat strong {
        display:block;
        margin-top:5px;
        font-size:19px;
      }

      .material-chart {
        position:relative;
        height:160px;
        margin-top:20px;
        padding:10px 5px;
        border-radius:13px;
        overflow:hidden;
        background:
          repeating-linear-gradient(
            to bottom,
            rgba(255,255,255,.025) 0,
            rgba(255,255,255,.025) 1px,
            transparent 1px,
            transparent 39px
          );
      }

      .material-zero {
        position:absolute;
        left:0;
        right:0;
        top:50%;
        height:1px;
        background:rgba(255,255,255,.16);
      }

      .material-bars {
        position:absolute;
        inset:10px 5px;
        display:flex;
        align-items:center;
        gap:2px;
      }

      .material-bar {
        flex:1;
        min-width:2px;
        max-width:12px;
        border:0;
        padding:0;
        opacity:.58;
        cursor:pointer;
        transition:
          opacity .15s,
          transform .15s;
      }

      .material-bar.white-side {
        align-self:flex-start;
        margin-top:50%;
        background:rgba(235,240,245,.65);
        transform-origin:top;
      }

      .material-bar.black-side {
        align-self:flex-end;
        margin-bottom:50%;
        background:rgba(120,145,160,.85);
        transform-origin:bottom;
      }

      .material-bar:hover {
        opacity:1;
        transform:scaleX(1.7);
      }

      .material-bar.material-critical {
        opacity:1;
        box-shadow:0 0 8px rgba(255,180,80,.55);
      }

      .material-events {
        margin-top:22px;
      }

      .material-events-head h3 {
        margin:4px 0 12px;
        font-size:16px;
      }

      .material-event {
        width:100%;
        display:grid;
        grid-template-columns:
          1fr 1.5fr 30px;
        align-items:center;
        gap:10px;
        padding:12px;
        margin-top:7px;
        border-radius:12px;
        border:1px solid rgba(255,255,255,.055);
        background:rgba(255,255,255,.025);
        color:inherit;
        text-align:left;
        cursor:pointer;
      }

      .material-event:hover {
        background:rgba(255,255,255,.07);
      }

      .material-event-move {
        display:flex;
        align-items:center;
        gap:9px;
      }

      .material-event-move span {
        width:26px;
        height:26px;
        display:grid;
        place-items:center;
        border-radius:7px;
        background:rgba(255,255,255,.07);
        font-size:10px;
      }

      .material-event-move strong {
        font-size:13px;
      }

      .material-event-center span {
        display:block;
        font-size:11px;
      }

      .material-event-center small {
        display:block;
        margin-top:3px;
        font-size:9px;
        opacity:.4;
      }

      .material-event-arrow {
        text-align:right;
        opacity:.4;
      }

      .material-empty {
        padding:16px;
        border-radius:12px;
        background:rgba(255,255,255,.03);
        font-size:12px;
        opacity:.5;
      }

      @media(max-width:700px) {
        .material-head {
          flex-direction:column;
        }

        .material-stats {
          grid-template-columns:
            repeat(2, 1fr);
        }

        .material-event {
          grid-template-columns:
            1fr 1fr 20px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectMaterialStyles();

  function mountMaterialDashboard() {
    setTimeout(() => {
      renderMaterialDashboard();
    }, 180);
  }

  if (typeof startReview === "function") {
    const oldStartReview = startReview;

    startReview = async function () {
      await oldStartReview.apply(this, arguments);
      mountMaterialDashboard();
    };
  }

  if (typeof renderPosition === "function") {
    const oldRenderPosition =
      renderPosition;

    renderPosition = function () {
      oldRenderPosition.apply(this, arguments);

      setTimeout(() => {
        renderMaterialDashboard();
      }, 100);
    };
  }

  console.log(
    "Chess Review Pro: Material Tactical Dashboard Patch Loaded"
  );
})();
/* =========================================================
   OPENING INTELLIGENCE PRO
   Opening recognition + deviation + opening report
   ========================================================= */

(function () {
  const OPENING_BOOK = [
    {
      name: "Italian Game",
      eco: "C50",
      moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"]
    },
    {
      name: "Ruy Lopez",
      eco: "C60",
      moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"]
    },
    {
      name: "Scotch Game",
      eco: "C45",
      moves: ["e4", "e5", "Nf3", "Nc6", "d4"]
    },
    {
      name: "Four Knights Game",
      eco: "C46",
      moves: ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6"]
    },
    {
      name: "Sicilian Defense",
      eco: "B20",
      moves: ["e4", "c5"]
    },
    {
      name: "French Defense",
      eco: "C00",
      moves: ["e4", "e6"]
    },
    {
      name: "Caro-Kann Defense",
      eco: "B10",
      moves: ["e4", "c6"]
    },
    {
      name: "Pirc Defense",
      eco: "B07",
      moves: ["e4", "d6", "d4", "Nf6"]
    },
    {
      name: "Modern Defense",
      eco: "B06",
      moves: ["e4", "g6"]
    },
    {
      name: "Queen's Gambit",
      eco: "D06",
      moves: ["d4", "d5", "c4"]
    },
    {
      name: "Slav Defense",
      eco: "D10",
      moves: ["d4", "d5", "c4", "c6"]
    },
    {
      name: "King's Indian Defense",
      eco: "E60",
      moves: ["d4", "Nf6", "c4", "g6"]
    },
    {
      name: "Nimzo-Indian Defense",
      eco: "E20",
      moves: ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"]
    },
    {
      name: "Queen's Indian Defense",
      eco: "E15",
      moves: ["d4", "Nf6", "c4", "e6", "Nf3", "b6"]
    },
    {
      name: "English Opening",
      eco: "A10",
      moves: ["c4"]
    },
    {
      name: "RÃ©ti Opening",
      eco: "A04",
      moves: ["Nf3"]
    }
  ];

  function getPlayedSAN() {
    if (!Array.isArray(reviewMoves)) return [];

    return reviewMoves
      .map(m => m.san || m.move || "")
      .filter(Boolean)
      .map(x =>
        String(x)
          .replace(/[+#?!]+$/g, "")
          .trim()
      );
  }

  function openingMatchScore(opening, played) {
    let matched = 0;

    for (
      let i = 0;
      i < opening.moves.length;
      i++
    ) {
      if (
        played[i] &&
        played[i] === opening.moves[i]
      ) {
        matched++;
      } else {
        break;
      }
    }

    return matched;
  }

  function detectOpening() {
    const played = getPlayedSAN();

    let best = null;

    for (const opening of OPENING_BOOK) {
      const matched =
        openingMatchScore(
          opening,
          played
        );

      if (
        !best ||
        matched > best.matched
      ) {
        best = {
          ...opening,
          matched
        };
      }
    }

    if (!best || best.matched === 0) {
      return {
        name: "Unclassified Opening",
        eco: String.fromCodePoint(0x2014),
        matched: 0,
        deviation: 1
      };
    }

    const deviation =
      best.matched < best.moves.length
        ? best.matched + 1
        : null;

    return {
      ...best,
      deviation
    };
  }

  function openingAccuracy(opening) {
    if (!Array.isArray(reviewMoves)) return 0;

    const openingCount =
      Math.min(
        reviewMoves.length,
        Math.max(
          opening.moves.length + 2,
          8
        )
      );

    const moves =
      reviewMoves.slice(0, openingCount);

    if (!moves.length) return 0;

    let total = 0;

    moves.forEach(m => {
      total += Number(m.cpl || 0);
    });

    const avg = total / moves.length;

    return Math.max(
      0,
      Math.min(
        100,
        100 * Math.exp(-avg / 90)
      )
    );
  }

  function renderOpeningIntel() {
    const old =
      document.getElementById(
        "openingIntelligence"
      );

    if (old) old.remove();

    const container =
      document.querySelector(
        "#reviewSection"
      );

    if (!container) return;

    const opening =
      detectOpening();

    const accuracy =
      openingAccuracy(opening);

    const deviationMove =
      opening.deviation
        ? getPlayedSAN()[
            opening.deviation - 1
          ]
        : null;

    const theoretical =
      opening.matched >=
      opening.moves.length;

    let status = "";

    if (theoretical) {
      status = `
        <span class="opening-status good">
                  ${String.fromCodePoint(0x2713)} Theory matched
        </span>
      `;
    } else if (opening.matched >= 2) {
      status = `
        <span class="opening-status neutral">
          Theory followed ${opening.matched}
          move${opening.matched > 1 ? "s" : ""}
        </span>
      `;
    } else {
      status = `
        <span class="opening-status neutral">
          Early deviation
        </span>
      `;
    }

    const section =
      document.createElement(
        "section"
      );

    section.id =
      "openingIntelligence";

    section.className =
      "opening-intelligence";

    section.innerHTML = `
      <div class="opening-top">

        <div>
          <span class="opening-eyebrow">
            OPENING INTELLIGENCE
          </span>

          <h2>
            ${opening.name}
          </h2>

          <p>
            ECO ${opening.eco}
            ${String.fromCodePoint(0x00B7)} ${opening.matched}
            theory move${opening.matched !== 1 ? "s" : ""}
            recognized
          </p>
        </div>

        <div class="opening-score">
          <span>OPENING ACCURACY</span>
          <strong>
            ${accuracy.toFixed(1)}%
          </strong>
        </div>

      </div>

      <div class="opening-status-row">
        ${status}
      </div>

      <div class="opening-flow">

        <div class="opening-flow-title">
          Your opening path
        </div>

        <div class="opening-moves">
          ${
            opening.moves
              .map((move, i) => `
                <span class="
                  opening-move
                  ${
                    i < opening.matched
                      ? "matched"
                      : ""
                  }
                ">
                  <small>
                    ${Math.floor(i / 2) + 1}${i % 2 === 0 ? "." : "..."}
                  </small>
                  ${move}
                </span>
              `)
              .join("")
          }
        </div>

      </div>

      ${
        opening.deviation
          ? `
            <div class="opening-deviation">

              <div class="opening-deviation-icon">
                ${String.fromCodePoint(0x21D2)}
              </div>

              <div>
                <span>
                  YOUR FIRST DEVIATION
                </span>

                <strong>
                  Move ${opening.deviation}
                  ${
                    deviationMove
                      ? ` ${String.fromCodePoint(0x00B7)} ${deviationMove}`
                      : ""
                  }
                </strong>

                <p>
                  This is where your game
                  stopped matching the
                  recognized opening sequence.
                </p>
              </div>

            </div>
          `
          : `
            <div class="opening-deviation positive">

              <div class="opening-deviation-icon">
                ${String.fromCodePoint(0x2713)}
              </div>

              <div>
                <span>
                  OPENING DISCIPLINE
                </span>

                <strong>
                  You stayed inside the
                  recognized line.
                </strong>

                <p>
                  The played moves matched
                  the opening pattern detected
                  by this review.
                </p>
              </div>

            </div>
          `
      }
    `;

    const material =
      document.getElementById(
        "materialDashboard"
      );

    if (material) {
      material.after(section);
    } else {
      container.appendChild(section);
    }
  }

  function injectOpeningStyles() {
    if (
      document.getElementById(
        "openingIntelStyles"
      )
    ) return;

    const style =
      document.createElement("style");

    style.id =
      "openingIntelStyles";

    style.textContent = `
      .opening-intelligence {
        margin-top:24px;
        padding:26px;
        border-radius:20px;
        border:1px solid rgba(255,255,255,.07);
        background:
          linear-gradient(
            145deg,
            rgba(255,255,255,.04),
            rgba(255,255,255,.018)
          );
      }

      .opening-top {
        display:flex;
        justify-content:space-between;
        gap:20px;
        align-items:flex-start;
      }

      .opening-eyebrow {
        display:block;
        font-size:10px;
        font-weight:800;
        letter-spacing:1.7px;
        opacity:.48;
      }

      .opening-top h2 {
        margin:5px 0 2px;
        font-size:23px;
      }

      .opening-top p {
        margin:0;
        font-size:11px;
        opacity:.5;
      }

      .opening-score {
        min-width:125px;
        padding:12px;
        text-align:center;
        border-radius:14px;
        background:rgba(255,255,255,.05);
      }

      .opening-score span {
        display:block;
        font-size:8px;
        letter-spacing:1.2px;
        opacity:.45;
      }

      .opening-score strong {
        display:block;
        margin-top:3px;
        font-size:22px;
      }

      .opening-status-row {
        margin-top:17px;
      }

      .opening-status {
        display:inline-block;
        padding:7px 10px;
        border-radius:20px;
        font-size:10px;
        font-weight:700;
      }

      .opening-status.good {
        background:rgba(70,220,140,.09);
        border:1px solid rgba(70,220,140,.15);
      }

      .opening-status.neutral {
        background:rgba(255,255,255,.055);
        border:1px solid rgba(255,255,255,.07);
        opacity:.7;
      }

      .opening-flow {
        margin-top:18px;
        padding:15px;
        border-radius:14px;
        background:rgba(0,0,0,.15);
        border:1px solid rgba(255,255,255,.05);
      }

      .opening-flow-title {
        font-size:10px;
        letter-spacing:1.2px;
        text-transform:uppercase;
        opacity:.42;
        margin-bottom:11px;
      }

      .opening-moves {
        display:flex;
        flex-wrap:wrap;
        gap:6px;
      }

      .opening-move {
        padding:7px 9px;
        border-radius:8px;
        background:rgba(255,255,255,.035);
        font-family:ui-monospace,
          SFMono-Regular,Menlo,monospace;
        font-size:12px;
        opacity:.4;
      }

      .opening-move.matched {
        opacity:1;
        background:rgba(80,220,145,.1);
        border:1px solid rgba(80,220,145,.12);
      }

      .opening-move small {
        margin-right:3px;
        font-size:8px;
        opacity:.4;
      }

      .opening-deviation {
        display:flex;
        gap:13px;
        margin-top:13px;
        padding:15px;
        border-radius:14px;
        background:rgba(255,180,70,.055);
        border:1px solid rgba(255,180,70,.1);
      }

      .opening-deviation.positive {
        background:rgba(70,220,140,.055);
        border-color:rgba(70,220,140,.1);
      }

      .opening-deviation-icon {
        width:30px;
        height:30px;
        flex-shrink:0;
        display:grid;
        place-items:center;
        border-radius:9px;
        background:rgba(255,255,255,.06);
        font-size:16px;
      }

      .opening-deviation span {
        display:block;
        font-size:8px;
        letter-spacing:1.2px;
        opacity:.45;
      }

      .opening-deviation strong {
        display:block;
        margin-top:3px;
        font-size:13px;
      }

      .opening-deviation p {
        margin:4px 0 0;
        font-size:11px;
        line-height:1.45;
        opacity:.55;
      }

      @media(max-width:650px) {
        .opening-top {
          flex-direction:column;
        }

        .opening-score {
          align-self:flex-start;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectOpeningStyles();

  if (typeof startReview === "function") {
    const oldStartReview =
      startReview;

    startReview = async function () {
      await oldStartReview.apply(
        this,
        arguments
      );

      setTimeout(
        renderOpeningIntel,
        250
      );
    };
  }

  console.log(
    "Chess Review Pro: Opening Intelligence Pro Patch Loaded"
  );
})();
/* =========================================================
   PLAYER STYLE / GAME DNA PRO
   ========================================================= */

(function () {

  function getStyleData() {
    if (!Array.isArray(reviewMoves) || !reviewMoves.length) {
      return null;
    }

    const moves = reviewMoves;

    let tactical = 50;
    let positional = 50;
    let aggression = 50;
    let defense = 50;
    let consistency = 50;

    let tacticalSignals = 0;
    let positionalSignals = 0;
    let aggressionSignals = 0;
    let defensiveSignals = 0;

    let cplTotal = 0;
    let cplSquared = 0;

    moves.forEach((m, i) => {
      const san = String(
        m.san || m.move || ""
      );

      const cpl = Number(
        m.cpl || 0
      );

      cplTotal += cpl;
      cplSquared += cpl * cpl;

      /* Tactical signals */

      if (
        san.includes("x") ||
        san.includes("+") ||
        san.includes("#") ||
        /[=]/.test(san)
      ) {
        tacticalSignals++;
      }

      if (
        /N/.test(san) &&
        /x/.test(san)
      ) {
        tacticalSignals += 1.5;
      }

      /* Aggression */

      if (
        san.includes("x") ||
        san.includes("+") ||
        san.includes("#")
      ) {
        aggressionSignals++;
      }

      if (
        /Q/.test(san) &&
        /x|\+/.test(san)
      ) {
        aggressionSignals += 1.5;
      }

      /* Positional */

      if (
        /^[a-h]/.test(san) &&
        !san.includes("x")
      ) {
        positionalSignals++;
      }

      if (
        /O-O|O-O-O/.test(san)
      ) {
        defensiveSignals++;
      }

      /* Defensive signals */

      if (
        /K/.test(san) ||
        /O-O/.test(san) ||
        /R/.test(san)
      ) {
        defensiveSignals++;
      }
    });

    const n = Math.max(
      1,
      moves.length
    );

    const avgCpl =
      cplTotal / n;

    const variance =
      Math.max(
        0,
        cplSquared / n -
        avgCpl * avgCpl
      );

    const volatility =
      Math.sqrt(variance);

    tactical =
      Math.max(
        0,
        Math.min(
          100,
          40 +
          tacticalSignals / n * 140
        )
      );

    positional =
      Math.max(
        0,
        Math.min(
          100,
          100 - tactical * 0.42
        )
      );

    aggression =
      Math.max(
        0,
        Math.min(
          100,
          35 +
          aggressionSignals / n * 180
        )
      );

    defense =
      Math.max(
        0,
        Math.min(
          100,
          45 +
          defensiveSignals / n * 120 -
          avgCpl * .15
        )
      );

    consistency =
      Math.max(
        0,
        Math.min(
          100,
          100 -
          avgCpl * .7 -
          volatility * .25
        )
      );

    const overall =
      Math.round(
        (
          tactical +
          positional +
          aggression +
          defense +
          consistency
        ) / 5
      );

    let archetype;

    if (
      tactical >= 70 &&
      aggression >= 65
    ) {
      archetype =
        "Tactical Attacker";
    } else if (
      positional >= 70 &&
      consistency >= 65
    ) {
      archetype =
        "Positional Controller";
    } else if (
      defense >= 68 &&
      aggression < 55
    ) {
      archetype =
        "Solid Defender";
    } else if (
      aggression >= 70
    ) {
      archetype =
        "Aggressive Fighter";
    } else if (
      consistency >= 70
    ) {
      archetype =
        "Reliable Player";
    } else {
      archetype =
        "Adaptive Player";
    }

    return {
      tactical,
      positional,
      aggression,
      defense,
      consistency,
      overall,
      archetype,
      avgCpl,
      volatility
    };
  }

  function styleDescription(data) {
    if (!data) return "";

    if (
      data.tactical >= 70 &&
      data.aggression >= 65
    ) {
      return `
        You naturally look for forcing moves,
        tactical opportunities and active play.
        Your biggest improvement area is making sure
        aggressive decisions are fully calculated.
      `;
    }

    if (
      data.positional >= 70
    ) {
      return `
        Your game shows a preference for
        controlled positions and gradual improvement.
        Look for opportunities to increase tactical
        awareness without abandoning your positional strengths.
      `;
    }

    if (
      data.defense >= 68
    ) {
      return `
        You tend to prioritize safety and stability.
        The next step is recognizing when the position
        demands active counterplay instead of passive defense.
      `;
    }

    return `
      Your style changes according to the position.
      Building stronger candidate-move habits will make
      your decisions more consistent across different phases.
    `;
  }

  function renderGameDNA() {
    const old =
      document.getElementById(
        "gameDNA"
      );

    if (old) old.remove();

    const data =
      getStyleData();

    if (!data) return;

    const container =
      document.querySelector(
        "#reviewSection"
      );

    if (!container) return;

    const section =
      document.createElement(
        "section"
      );

    section.id =
      "gameDNA";

    section.className =
      "game-dna";

    const metrics = [
      ["Tactical", data.tactical],
      ["Positional", data.positional],
      ["Aggression", data.aggression],
      ["Defense", data.defense],
      ["Consistency", data.consistency]
    ];

    section.innerHTML = `
      <div class="dna-header">

        <div>
          <span class="dna-eyebrow">
            PLAYER PROFILE
          </span>

          <h2>
            Your Game DNA
          </h2>

          <p>
            A style profile generated from the decisions
            in this game.
          </p>
        </div>

        <div class="dna-archetype">
          <span>PLAY STYLE</span>
          <strong>
            ${data.archetype}
          </strong>
          <small>
            DNA ${data.overall}/100
          </small>
        </div>

      </div>

      <div class="dna-body">

        <div class="dna-metrics">

          ${metrics.map(([name, value]) => `
            <div class="dna-metric">

              <div class="dna-metric-top">
                <span>${name}</span>
                <strong>
                  ${Math.round(value)}
                </strong>
              </div>

              <div class="dna-track">
                <div
                  class="dna-fill"
                  style="width:${value}%"
                ></div>
              </div>

            </div>
          `).join("")}

        </div>

        <div class="dna-summary">

          <span class="dna-eyebrow">
            COACH SUMMARY
          </span>

          <p>
            ${styleDescription(data)}
          </p>

          <div class="dna-mini-stats">

            <div>
              <span>AVG CPL</span>
              <strong>
                ${data.avgCpl.toFixed(1)}
              </strong>
            </div>

            <div>
              <span>VOLATILITY</span>
              <strong>
                ${data.volatility.toFixed(1)}
              </strong>
            </div>

          </div>

        </div>

      </div>
    `;

    const opening =
      document.getElementById(
        "openingIntelligence"
      );

    if (opening) {
      opening.after(section);
    } else {
      container.appendChild(section);
    }
  }

  function injectDNAStyles() {
    if (
      document.getElementById(
        "gameDNAStyles"
      )
    ) return;

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "gameDNAStyles";

    style.textContent = `
      .game-dna {
        margin-top:24px;
        padding:26px;
        border-radius:20px;
        border:1px solid rgba(255,255,255,.07);
        background:
          linear-gradient(
            145deg,
            rgba(255,255,255,.04),
            rgba(255,255,255,.018)
          );
      }

      .dna-header {
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:20px;
      }

      .dna-eyebrow {
        display:block;
        font-size:10px;
        font-weight:800;
        letter-spacing:1.7px;
        opacity:.45;
      }

      .dna-header h2 {
        margin:5px 0 3px;
        font-size:22px;
      }

      .dna-header p {
        margin:0;
        font-size:12px;
        opacity:.5;
      }

      .dna-archetype {
        min-width:145px;
        padding:13px;
        border-radius:14px;
        text-align:center;
        background:rgba(255,255,255,.05);
        border:1px solid rgba(255,255,255,.06);
      }

      .dna-archetype span {
        display:block;
        font-size:8px;
        letter-spacing:1.3px;
        opacity:.4;
      }

      .dna-archetype strong {
        display:block;
        margin-top:4px;
        font-size:13px;
      }

      .dna-archetype small {
        display:block;
        margin-top:4px;
        font-size:9px;
        opacity:.4;
      }

      .dna-body {
        display:grid;
        grid-template-columns:
          1.15fr .85fr;
        gap:25px;
        margin-top:24px;
      }

      .dna-metrics {
        display:flex;
        flex-direction:column;
        gap:13px;
      }

      .dna-metric-top {
        display:flex;
        justify-content:space-between;
        align-items:center;
        margin-bottom:6px;
      }

      .dna-metric-top span {
        font-size:11px;
        opacity:.65;
      }

      .dna-metric-top strong {
        font-size:12px;
      }

      .dna-track {
        height:7px;
        border-radius:20px;
        overflow:hidden;
        background:rgba(255,255,255,.055);
      }

      .dna-fill {
        height:100%;
        border-radius:20px;
        background:linear-gradient(
          90deg,
          rgba(255,255,255,.28),
          rgba(255,255,255,.8)
        );
      }

      .dna-summary {
        padding:17px;
        border-radius:14px;
        background:rgba(0,0,0,.15);
        border:1px solid rgba(255,255,255,.05);
      }

      .dna-summary p {
        margin:10px 0 0;
        font-size:12px;
        line-height:1.65;
        opacity:.62;
      }

      .dna-mini-stats {
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:8px;
        margin-top:17px;
      }

      .dna-mini-stats div {
        padding:11px;
        border-radius:10px;
        background:rgba(255,255,255,.04);
      }

      .dna-mini-stats span {
        display:block;
        font-size:8px;
        letter-spacing:1px;
        opacity:.4;
      }

      .dna-mini-stats strong {
        display:block;
        margin-top:4px;
        font-size:16px;
      }

      @media(max-width:750px) {
        .dna-header {
          flex-direction:column;
        }

        .dna-archetype {
          align-self:flex-start;
        }

        .dna-body {
          grid-template-columns:1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectDNAStyles();

  if (
    typeof startReview ===
    "function"
  ) {
    const oldStartReview =
      startReview;

    startReview = async function () {
      await oldStartReview.apply(
        this,
        arguments
      );

      setTimeout(
        renderGameDNA,
        300
      );
    };
  }

  console.log(
    "Chess Review Pro: Game DNA Pro Patch Loaded"
  );

})();
/* =========================================================
   MOVE-BY-MOVE COACH PRO
   ========================================================= */

(function () {

  function getCurrentReviewMove() {
    if (
      typeof currentPositionIndex === "undefined" ||
      !Array.isArray(reviewMoves)
    ) {
      return null;
    }

    return reviewMoves[currentPositionIndex - 1] || null;
  }

  function moveSide(move) {
    if (!move) return "Player";

    if (move.color === "w") return "White";
    if (move.color === "b") return "Black";

    return move.side || "Player";
  }

  function moveType(move) {
    const cls =
      String(
        move?.classification || ""
      ).toLowerCase();

    if (cls.includes("brilliant")) return "brilliant";
    if (cls.includes("great")) return "great";
    if (cls.includes("best")) return "best";
    if (cls.includes("excellent")) return "excellent";
    if (cls.includes("good")) return "good";
    if (cls.includes("book")) return "book";
    if (cls.includes("inaccuracy")) return "inaccuracy";
    if (cls.includes("mistake")) return "mistake";
    if (cls.includes("miss")) return "miss";
    if (cls.includes("blunder")) return "blunder";

    return "neutral";
  }

  function getMoveTitle(type) {
    const titles = {
      brilliant: "Brilliant Move",
      great: "Great Move",
      best: "Best Move",
      excellent: "Excellent Move",
      good: "Good Move",
      book: "Book Move",
      inaccuracy: "Inaccuracy",
      mistake: "Mistake",
      miss: "Missed Opportunity",
      blunder: "Blunder"
    };

    return titles[type] || "Move Review";
  }

  function getMoveAdvice(move, type) {
    const cpl =
      Number(move?.cpl || 0);

    if (type === "brilliant") {
      return "You found a highly precise move that creates a strong tactical or positional advantage.";
    }

    if (type === "great") {
      return "A very strong decision. This move keeps the position on a highly accurate path.";
    }

    if (
      type === "best" ||
      type === "excellent"
    ) {
      return "This move closely matches the engine's preferred continuation.";
    }

    if (type === "good") {
      return "A solid practical move. There may be a stronger continuation, but this keeps the position healthy.";
    }

    if (type === "book") {
      return "This follows a known opening continuation.";
    }

    if (type === "inaccuracy") {
      return `The position remains playable, but this move gives away approximately ${cpl} centipawns of potential.`;
    }

    if (type === "mistake") {
      return `This move loses meaningful engine value. Before committing, compare forcing moves and check your opponent's immediate threats.`;
    }

    if (type === "miss") {
      return "A stronger opportunity was available. The key improvement is to actively search for forcing continuations.";
    }

    if (type === "blunder") {
      return `A major evaluation swing occurred here. Pause before the move and check checks, captures and threats.`;
    }

    return "Review the position carefully and compare your move with the engine continuation.";
  }

  function getThreatText(move) {
    const cpl =
      Number(move?.cpl || 0);

    if (cpl >= 100) {
      return "The opponent can exploit the change in the position immediately.";
    }

    if (cpl >= 50) {
      return "Your move allowed the opponent a stronger continuation than expected.";
    }

    return "No major immediate tactical threat was created by this move.";
  }

  function getBestMove(move) {
    return (
      move?.bestmove ||
      move?.bestMove ||
      move?.engineMove ||
      move?.best ||
      "Not available"
    );
  }

  function renderMoveCoach() {
    const old =
      document.getElementById(
        "moveCoachPanel"
      );

    if (old) old.remove();

    const move =
      getCurrentReviewMove();

    if (!move) return;

    const container =
      document.querySelector(
        "#reviewSection"
      );

    if (!container) return;

    const type =
      moveType(move);

    const title =
      getMoveTitle(type);

    const best =
      getBestMove(move);

    const san =
      move.san ||
      move.move ||
      String.fromCodePoint(0x2014);

    const cpl =
      Number(move.cpl || 0);

    const section =
      document.createElement(
        "section"
      );

    section.id =
      "moveCoachPanel";

    section.className =
      "move-coach-panel";

    section.innerHTML = `
      <div class="move-coach-header">

        <div>
          <span class="move-coach-eyebrow">
            MOVE-BY-MOVE COACH
          </span>

          <h2>
            ${title}
          </h2>

          <p>
            ${moveSide(move)}
            ${String.fromCodePoint(0x00B7)} Move ${currentPositionIndex || String.fromCodePoint(0x2014)}
          </p>
        </div>

        <div class="
          move-coach-badge
          ${type}
        ">
          ${move.classification || "Review"}
        </div>

      </div>

      <div class="move-coach-main">

        <div class="move-coach-moves">

          <div class="coach-move-box played">
            <span>YOUR MOVE</span>
            <strong>
              ${san}
            </strong>
          </div>

          <div class="coach-arrow">
            ${String.fromCodePoint(0x2192)}
          </div>

          <div class="coach-move-box best">
            <span>ENGINE CHOICE</span>
            <strong>
              ${best}
            </strong>
          </div>

        </div>

        <div class="coach-cpl">
          <span>PRECISION LOSS</span>
          <strong>
            ${cpl}
          </strong>
          <small>CPL</small>
        </div>

      </div>

      <div class="coach-explanation">

        <div class="coach-explanation-icon">
          ${String.fromCodePoint(0x1F4A1)}
        </div>

        <div>
          <span>
            WHY THIS MOVE?
          </span>

          <p>
            ${move.explanation ||
              getMoveAdvice(move, type)}
          </p>
        </div>

      </div>

      <div class="coach-threat">

        <div class="coach-threat-icon">
          ${String.fromCodePoint(0x1F441)}
        </div>

        <div>
          <span>
            POSITIONAL CHECK
          </span>

          <p>
            ${getThreatText(move)}
          </p>
        </div>

      </div>

      <div class="coach-tip">
        <strong>Coach tip</strong>
        <span>
          ${
            type === "blunder" ||
            type === "mistake" ||
            type === "miss"
              ? "Before playing, calculate at least one forcing response from your opponent."
              : "Keep comparing candidate moves when the position contains tactical possibilities."
          }
        </span>
      </div>
    `;

    const graph =
      document.getElementById(
        "evaluationGraph"
      );

    if (
      graph &&
      graph.parentElement
    ) {
      graph.parentElement.after(
        section
      );
    } else {
      container.appendChild(
        section
      );
    }
  }

  function injectMoveCoachStyles() {
    if (
      document.getElementById(
        "moveCoachStyles"
      )
    ) return;

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "moveCoachStyles";

    style.textContent = `
      .move-coach-panel {
        margin-top:24px;
        padding:25px;
        border-radius:20px;
        border:1px solid rgba(255,255,255,.07);
        background:
          linear-gradient(
            145deg,
            rgba(255,255,255,.045),
            rgba(255,255,255,.018)
          );
      }

      .move-coach-header {
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:15px;
      }

      .move-coach-eyebrow {
        display:block;
        font-size:10px;
        font-weight:800;
        letter-spacing:1.7px;
        opacity:.45;
      }

      .move-coach-header h2 {
        margin:5px 0 2px;
        font-size:21px;
      }

      .move-coach-header p {
        margin:0;
        font-size:11px;
        opacity:.45;
      }

      .move-coach-badge {
        padding:8px 11px;
        border-radius:20px;
        font-size:10px;
        font-weight:800;
        text-transform:uppercase;
        letter-spacing:.5px;
        background:rgba(255,255,255,.06);
      }

      .move-coach-badge.brilliant,
      .move-coach-badge.best,
      .move-coach-badge.great,
      .move-coach-badge.excellent,
      .move-coach-badge.good {
        color:#6ee7a5;
        background:rgba(70,220,140,.09);
      }

      .move-coach-badge.inaccuracy {
        color:#ffd166;
      }

      .move-coach-badge.mistake,
      .move-coach-badge.miss {
        color:#ffb45c;
      }

      .move-coach-badge.blunder {
        color:#ff7070;
        background:rgba(255,70,70,.08);
      }

      .move-coach-main {
        display:flex;
        align-items:center;
        gap:18px;
        margin-top:20px;
      }

      .move-coach-moves {
        flex:1;
        display:flex;
        align-items:center;
        gap:10px;
      }

      .coach-move-box {
        flex:1;
        padding:14px;
        border-radius:13px;
        border:1px solid rgba(255,255,255,.06);
        background:rgba(255,255,255,.035);
      }

      .coach-move-box.best {
        background:rgba(70,220,140,.06);
        border-color:rgba(70,220,140,.12);
      }

      .coach-move-box span {
        display:block;
        font-size:8px;
        letter-spacing:1.2px;
        opacity:.42;
      }

      .coach-move-box strong {
        display:block;
        margin-top:5px;
        font-family:ui-monospace,
          SFMono-Regular,Menlo,monospace;
        font-size:17px;
      }

      .coach-arrow {
        opacity:.4;
        font-size:18px;
      }

      .coach-cpl {
        min-width:90px;
        padding:13px;
        text-align:center;
        border-radius:13px;
        background:rgba(255,255,255,.045);
      }

      .coach-cpl span {
        display:block;
        font-size:8px;
        letter-spacing:1px;
        opacity:.4;
      }

      .coach-cpl strong {
        font-size:20px;
        display:inline-block;
        margin-top:3px;
      }

      .coach-cpl small {
        font-size:8px;
        opacity:.4;
        margin-left:2px;
      }

      .coach-explanation,
      .coach-threat {
        display:flex;
        gap:13px;
        margin-top:13px;
        padding:15px;
        border-radius:14px;
        background:rgba(255,255,255,.035);
        border:1px solid rgba(255,255,255,.05);
      }

      .coach-explanation-icon,
      .coach-threat-icon {
        font-size:21px;
      }

      .coach-explanation span,
      .coach-threat span {
        display:block;
        font-size:8px;
        letter-spacing:1.3px;
        opacity:.43;
      }

      .coach-explanation p,
      .coach-threat p {
        margin:5px 0 0;
        font-size:12px;
        line-height:1.55;
        opacity:.65;
      }

      .coach-tip {
        display:flex;
        gap:8px;
        margin-top:12px;
        padding:11px 13px;
        border-radius:10px;
        background:rgba(255,255,255,.025);
        font-size:11px;
      }

      .coach-tip strong {
        white-space:nowrap;
      }

      .coach-tip span {
        opacity:.55;
      }

      @media(max-width:700px) {
        .move-coach-main {
          flex-direction:column;
          align-items:stretch;
        }

        .coach-cpl {
          width:auto;
        }

        .move-coach-moves {
          width:100%;
        }
      }

      @media(max-width:480px) {
        .move-coach-moves {
          flex-direction:column;
        }

        .coach-arrow {
          transform:rotate(90deg);
        }

        .coach-move-box {
          width:100%;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

  injectMoveCoachStyles();

  /*
   * Render when analysis starts.
   */
  if (
    typeof startReview ===
    "function"
  ) {
    const oldStartReview =
      startReview;

    startReview = async function () {
      await oldStartReview.apply(
        this,
        arguments
      );

      setTimeout(
        renderMoveCoach,
        300
      );
    };
  }

  /*
   * Keep panel synced with board navigation.
   */
  if (
    typeof renderPosition ===
    "function"
  ) {
    const oldRenderPosition =
      renderPosition;

    renderPosition = function () {
      oldRenderPosition.apply(
        this,
        arguments
      );

      setTimeout(
        renderMoveCoach,
        60
      );
    };
  }

  console.log(
    "Chess Review Pro: Move-by-Move Coach Pro Patch Loaded"
  );

})();
/* =========================================================
   COACH PATCH FIX
   Works with the actual Analyze button
   ========================================================= */

(function () {

  function runCoachAfterAnalysis() {
    setTimeout(() => {

      if (typeof renderCoachInsights === "function") {
        try {
          renderCoachInsights();
        } catch (err) {
          console.error(
            "Coach Insights render error:",
            err
          );
        }
      }

      if (
        typeof renderRetrySection === "function"
      ) {
        try {
          renderRetrySection();
        } catch (err) {
          console.error(
            "Retry section render error:",
            err
          );
        }
      }

    }, 500);
  }

  const analyzeButton =
    document.getElementById("analyzeButton");

  if (analyzeButton) {

    analyzeButton.addEventListener(
      "click",
      () => {
        runCoachAfterAnalysis();
      }
    );

    console.log(
      "Chess Review Pro: Coach Analysis Hook Connected"
    );

  } else {

    console.warn(
      "Chess Review Pro: analyzeButton not found"
    );

  }

})();

/* =========================================================
   TACTICAL ALERT SYSTEM PRO
   ========================================================= */

(function () {

  function getCurrentMoveForTactics() {
    if (
      typeof currentPositionIndex === "undefined" ||
      !Array.isArray(reviewMoves)
    ) return null;

    return reviewMoves[currentPositionIndex - 1] || null;
  }

  function getFenForTactics(move) {
    if (!move) return null;

    return (
      move.fenAfter ||
      move.afterFen ||
      move.fen ||
      null
    );
  }

  function tacticalSignals(move) {
    const signals = [];
    if (!move) return signals;

    const san = String(
      move.san || move.move || ""
    );

    const cpl = Number(move.cpl || 0);

    if (san.includes("#")) {
      signals.push({
        type: "checkmate",
        icon: "♛",
        title: "Checkmate",
        text: "This move ends the game immediately."
      });
    } else if (san.includes("+")) {
      signals.push({
        type: "check",
        icon: "⚡",
        title: "Check",
        text: "The king is under direct attack."
      });
    }

    if (san.includes("x")) {
      signals.push({
        type: "capture",
        icon: "⚔️",
        title: "Capture",
        text: "Material changed through a capture."
      });
    }

    if (
      /N.*x/.test(san) &&
      cpl <= 35
    ) {
      signals.push({
        type: "tactical",
        icon: "♞",
        title: "Knight Tactic",
        text: "The knight capture may create a tactical imbalance."
      });
    }

    if (
      /Q.*x/.test(san) &&
      cpl <= 35
    ) {
      signals.push({
        type: "tactical",
        icon: "♕",
        title: "Queen Tactic",
        text: "The queen is involved in a tactical sequence."
      });
    }

    if (
      cpl >= 100
    ) {
      signals.push({
        type: "danger",
        icon: "🚨",
        title: "Tactical Danger",
        text: "The evaluation dropped sharply after this move."
      });
    } else if (
      cpl >= 55
    ) {
      signals.push({
        type: "warning",
        icon: "⚠️",
        title: "Tactical Warning",
        text: "A stronger tactical continuation was available."
      });
    }

    if (
      move.bestmove &&
      move.bestmove !== move.uci &&
      cpl >= 45
    ) {
      signals.push({
        type: "opportunity",
        icon: "🎯",
        title: "Missed Opportunity",
        text:
          `Engine preferred ${move.bestmove} in this position.`
      });
    }

    return signals;
  }

  function renderTacticalAlerts() {

    const old =
      document.getElementById(
        "tacticalAlerts"
      );

    if (old) old.remove();

    const move =
      getCurrentMoveForTactics();

    if (!move) return;

    const signals =
      tacticalSignals(move);

    if (!signals.length) return;

    const container =
      document.querySelector(
        "#reviewSection"
      );

    if (!container) return;

    const section =
      document.createElement(
        "section"
      );

    section.id =
      "tacticalAlerts";

    section.className =
      "tactical-alerts";

    section.innerHTML = `
      <div class="tactical-header">

        <div>
          <span class="tactical-eyebrow">
            TACTICAL SCAN
          </span>

          <h2>
            Position Alerts
          </h2>

          <p>
            Tactical signals detected in this position.
          </p>
        </div>

        <div class="tactical-count">
          ${signals.length}
        </div>

      </div>

      <div class="tactical-list">

        ${signals.map(signal => `
          <div class="
            tactical-card
            ${signal.type}
          ">

            <div class="tactical-icon">
              ${signal.icon}
            </div>

            <div class="tactical-content">

              <strong>
                ${signal.title}
              </strong>

              <p>
                ${signal.text}
              </p>

            </div>

          </div>
        `).join("")}

      </div>
    `;

    const moveCoach =
      document.getElementById(
        "moveCoachPanel"
      );

    if (moveCoach) {
      moveCoach.after(section);
    } else {
      container.appendChild(section);
    }
  }

  function injectTacticalStyles() {

    if (
      document.getElementById(
        "tacticalAlertStyles"
      )
    ) return;

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "tacticalAlertStyles";

    style.textContent = `
      .tactical-alerts {
        margin-top:18px;
        padding:21px;
        border-radius:18px;
        border:1px solid rgba(255,255,255,.06);
        background:rgba(255,255,255,.025);
      }

      .tactical-header {
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:15px;
      }

      .tactical-eyebrow {
        display:block;
        font-size:9px;
        font-weight:800;
        letter-spacing:1.6px;
        opacity:.43;
      }

      .tactical-header h2 {
        margin:4px 0 2px;
        font-size:18px;
      }

      .tactical-header p {
        margin:0;
        font-size:11px;
        opacity:.48;
      }

      .tactical-count {
        width:30px;
        height:30px;
        display:grid;
        place-items:center;
        border-radius:9px;
        background:rgba(255,255,255,.06);
        font-size:11px;
      }

      .tactical-list {
        display:grid;
        grid-template-columns:
          repeat(2, 1fr);
        gap:8px;
        margin-top:15px;
      }

      .tactical-card {
        display:flex;
        gap:11px;
        padding:13px;
        border-radius:12px;
        border:1px solid rgba(255,255,255,.05);
        background:rgba(255,255,255,.025);
      }

      .tactical-icon {
        font-size:20px;
        line-height:1;
      }

      .tactical-content strong {
        display:block;
        font-size:12px;
      }

      .tactical-content p {
        margin:4px 0 0;
        font-size:10px;
        line-height:1.45;
        opacity:.55;
      }

      .tactical-card.danger {
        background:rgba(255,70,70,.07);
        border-color:rgba(255,70,70,.13);
      }

      .tactical-card.warning {
        background:rgba(255,180,70,.06);
        border-color:rgba(255,180,70,.12);
      }

      .tactical-card.opportunity {
        background:rgba(110,100,255,.07);
        border-color:rgba(110,100,255,.12);
      }

      .tactical-card.check,
      .tactical-card.checkmate {
        background:rgba(70,220,140,.06);
        border-color:rgba(70,220,140,.12);
      }

      @media(max-width:650px) {
        .tactical-list {
          grid-template-columns:1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectTacticalStyles();

  if (
    typeof renderPosition ===
    "function"
  ) {

    const oldRenderPosition =
      renderPosition;

    renderPosition = function () {

      oldRenderPosition.apply(
        this,
        arguments
      );

      setTimeout(
        renderTacticalAlerts,
        80
      );
    };
  }

  if (
    typeof analyzeGame ===
    "function"
  ) {

    const oldAnalyzeGame =
      analyzeGame;

    analyzeGame = async function () {

      const result =
        await oldAnalyzeGame.apply(
          this,
          arguments
        );

      setTimeout(
        renderTacticalAlerts,
        400
      );

      return result;
    };
  }

  console.log(
    "Chess Review Pro: Tactical Alert System Loaded"
  );

})();
/* =========================================================
   UTF-8 CHESS PIECE FIX
   ========================================================= */

(function () {

  window.chessPieceGlyph = function (piece) {

    const white = {
      p: String.fromCodePoint(0x2659),
      r: String.fromCodePoint(0x2656),
      n: String.fromCodePoint(0x2658),
      b: String.fromCodePoint(0x2657),
      q: String.fromCodePoint(0x2655),
      k: String.fromCodePoint(0x2654)
    };

    const black = {
      p: String.fromCodePoint(0x265F),
      r: String.fromCodePoint(0x265C),
      n: String.fromCodePoint(0x265E),
      b: String.fromCodePoint(0x265D),
      q: String.fromCodePoint(0x265B),
      k: String.fromCodePoint(0x265A)
    };

    return piece?.color === "w"
      ? white[piece.type] || ""
      : black[piece.type] || "";
  };

  /*
   * Replace the global piece renderer if one exists.
   */
  if (typeof pieceGlyph === "function") {
    pieceGlyph = function (piece) {
      return window.chessPieceGlyph(piece);
    };
  }

  console.log(
    "Chess Review Pro: UTF-8 Chess Piece Fix Loaded"
  );

})();
/* =========================================================
   FINAL BOARD MOJIBAKE REPAIR
   Repairs already-rendered corrupted chess glyphs
   ========================================================= */

(function () {

  const PIECES = {
    "\u00e2\u2122\u0094": String.fromCodePoint(0x2654), // ♔
    "\u00e2\u2122\u0095": String.fromCodePoint(0x2655), // ♕
    "\u00e2\u2122\u0096": String.fromCodePoint(0x2656), // ♖
    "\u00e2\u2122\u0097": String.fromCodePoint(0x2657), // ♗
    "\u00e2\u2122\u0098": String.fromCodePoint(0x2658), // ♘
    "\u00e2\u2122\u0099": String.fromCodePoint(0x2659), // ♙

    "\u00e2\u2122\u009a": String.fromCodePoint(0x265A), // ♚
    "\u00e2\u2122\u009b": String.fromCodePoint(0x265B), // ♛
    "\u00e2\u2122\u009c": String.fromCodePoint(0x265C), // ♜
    "\u00e2\u2122\u009d": String.fromCodePoint(0x265D), // ♝
    "\u00e2\u2122\u009e": String.fromCodePoint(0x265E), // ♞
    "\u00e2\u2122\u009f": String.fromCodePoint(0x265F)  // ♟
  };

  const EXTRA = {
    "\u00e2\u0080\u0094": "—",
    "\u00e2\u0080\u0093": "–",
    "\u00e2\u0086\u0092": "→",
    "\u00e2\u0086\u0090": "←",
    "\u00e2\u0086\u0091": "↑",
    "\u00e2\u0086\u0093": "↓"
  };

  function repairText(text) {
    let result = text;

    Object.keys(PIECES).forEach(
      bad => {
        result = result.split(bad).join(
          PIECES[bad]
        );
      }
    );

    Object.keys(EXTRA).forEach(
      bad => {
        result = result.split(bad).join(
          EXTRA[bad]
        );
      }
    );

    return result;
  }

  function repairNode(root) {
    if (!root) return;

    const walker =
      document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );

    const nodes = [];

    let node;

    while (
      (node = walker.nextNode())
    ) {
      nodes.push(node);
    }

    nodes.forEach(textNode => {
      const fixed =
        repairText(
          textNode.nodeValue
        );

      if (
        fixed !== textNode.nodeValue
      ) {
        textNode.nodeValue = fixed;
      }
    });
  }

  function repairEverything() {
    repairNode(
      document.getElementById(
        "chessBoard"
      )
    );

    repairNode(
      document.getElementById(
        "reviewSection"
      )
    );
  }

  /*
   * Repair immediately.
   */
  repairEverything();

  /*
   * Repair after board renders.
   */
  const board =
    document.getElementById(
      "chessBoard"
    );

  if (board) {

    const observer =
      new MutationObserver(() => {
        repairNode(board);
      });

    observer.observe(
      board,
      {
        childList: true,
        subtree: true,
        characterData: true
      }
    );

    window.chessBoardEncodingObserver =
      observer;
  }

  /*
   * Also repair after position changes.
   */
  if (
    typeof renderPosition ===
    "function"
  ) {

    const oldRenderPosition =
      renderPosition;

    renderPosition = function () {

      oldRenderPosition.apply(
        this,
        arguments
      );

      setTimeout(
        repairEverything,
        0
      );

      setTimeout(
        repairEverything,
        80
      );
    };
  }

  console.log(
    "Chess Review Pro: Final Board Encoding Fix Loaded"
  );

})();




