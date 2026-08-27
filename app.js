const RANKS = "23456789TJQKA";
const SUITS = [
  { key: "C", symbol: "♣", name: "梅花", red: false },
  { key: "D", symbol: "♦", name: "方块", red: true },
  { key: "H", symbol: "♥", name: "红心", red: true },
  { key: "S", symbol: "♠", name: "黑桃", red: false },
];
const HAND_RANKS = ["Royal Flush", "Straight Flush", "Four of a Kind", "Full House", "Flush", "Straight", "Three of a Kind", "Two Pair", "One Pair", "High Card"];
const PAYOUT = { "Royal Flush": 1000, "Straight Flush": 100, "Four of a Kind": 50, "Full House": 15, Flush: 10, Straight: 8, "Three of a Kind": 4, "Two Pair": 3, "One Pair": 2, "High Card": 0 };
const SUIT_SYMBOL = Object.fromEntries(SUITS.map((suit) => [suit.key, suit.symbol]));
const RED_SUITS = new Set(["D", "H"]);
const state = { hand: [], solutions: [], activeSolution: null };
let drawRequest = 0;

const $ = (id) => document.getElementById(id);
const deck = RANKS.split("").flatMap((rank) => SUITS.map((suit) => rank + suit.key));
const CARD_ID = new Map(deck.map((card, index) => [card, index]));
const CARD_RANK = Uint8Array.from(deck, (_, index) => index >> 2);
const CARD_SUIT = Uint8Array.from(deck, (_, index) => index & 3);
const PAYOUT_VALUES = HAND_RANKS.map((name) => PAYOUT[name]);
const ROYAL_MASK = 0b11111 << 8;
const STRAIGHT_MASKS = (() => {
  const masks = new Uint8Array(1 << 13);
  masks[0b1000000001111] = 1;
  for (let start = 0; start < 9; start += 1) masks[0b11111 << start] = 1;
  return masks;
})();

function cardLabel(card) { return `${card[0]}${SUIT_SYMBOL[card[1]]}`; }
function cardImagePath(card) { return `assets/cards/${card}.webp`; }
function cardElement(card, compact = false) {
  const element = document.createElement("div");
  element.className = `card${RED_SUITS.has(card[1]) ? " red" : ""}`;
  element.innerHTML = `<img src="${cardImagePath(card)}" alt="${cardLabel(card)}" draggable="false">`;
  element.title = cardLabel(card);
  if (compact) element.classList.add("compact");
  return element;
}

function renderDeck() {
  const container = $("deck");
  container.replaceChildren();
  RANKS.split("").forEach((rank) => {
    const group = document.createElement("section");
    group.className = "deck-group";
    group.innerHTML = `<h3 class="deck-group-title">${rank === "T" ? "10" : rank}</h3>`;
    const cards = document.createElement("div");
    cards.className = "deck-group-cards";
    deck.filter((card) => card[0] === rank).forEach((card) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `deck-card${RED_SUITS.has(card[1]) ? " red" : ""}${state.hand.includes(card) ? " selected" : ""}`;
      button.disabled = !state.hand.includes(card) && state.hand.length >= 5;
      button.innerHTML = `<img src="${cardImagePath(card)}" alt="${cardLabel(card)}" loading="lazy" draggable="false">`;
      button.setAttribute("aria-label", cardLabel(card));
      button.addEventListener("click", () => toggleCard(card));
      cards.appendChild(button);
    });
    group.appendChild(cards);
    container.appendChild(group);
  });
}

function renderHand() {
  const container = $("selected-hand");
  container.replaceChildren();
  if (!state.hand.length) {
    container.classList.add("empty-state");
    container.textContent = "请从牌堆选择 5 张牌";
  } else {
    container.classList.remove("empty-state");
    state.hand.forEach((card) => {
      const element = cardElement(card);
      element.addEventListener("click", () => toggleCard(card));
      container.appendChild(element);
    });
  }
  $("hand-count").textContent = `${state.hand.length} / 5`;
  $("solve-button").disabled = state.hand.length !== 5;
}

function toggleCard(card) {
  drawRequest += 1;
  if (state.hand.includes(card)) state.hand = state.hand.filter((item) => item !== card);
  else if (state.hand.length < 5) state.hand = [...state.hand, card];
  state.solutions = [];
  $("result-panel").classList.add("hidden");
  $("draw-progress").classList.add("hidden");
  $("error-message").textContent = "";
  renderHand();
  renderDeck();
}

function evaluateEncodedHand(card0, card1, card2, card3, card4) {
  const rank0 = CARD_RANK[card0]; const rank1 = CARD_RANK[card1]; const rank2 = CARD_RANK[card2]; const rank3 = CARD_RANK[card3]; const rank4 = CARD_RANK[card4];
  const rankMask = (1 << rank0) | (1 << rank1) | (1 << rank2) | (1 << rank3) | (1 << rank4);
  const flush = CARD_SUIT[card0] === CARD_SUIT[card1] && CARD_SUIT[card0] === CARD_SUIT[card2] && CARD_SUIT[card0] === CARD_SUIT[card3] && CARD_SUIT[card0] === CARD_SUIT[card4];
  const uniqueRanks = rank0 !== rank1 && rank0 !== rank2 && rank0 !== rank3 && rank0 !== rank4 && rank1 !== rank2 && rank1 !== rank3 && rank1 !== rank4 && rank2 !== rank3 && rank2 !== rank4 && rank3 !== rank4;
  if (uniqueRanks) {
    const straight = STRAIGHT_MASKS[rankMask] === 1;
    if (flush && straight) return rankMask === ROYAL_MASK ? 0 : 1;
    if (flush) return 4;
    if (straight) return 5;
    return 9;
  }

  const count0 = (rank0 === rank0) + (rank1 === rank0) + (rank2 === rank0) + (rank3 === rank0) + (rank4 === rank0);
  const count1 = rank1 === rank0 ? 0 : (rank0 === rank1) + (rank1 === rank1) + (rank2 === rank1) + (rank3 === rank1) + (rank4 === rank1);
  const count2 = rank2 === rank0 || rank2 === rank1 ? 0 : (rank0 === rank2) + (rank1 === rank2) + (rank2 === rank2) + (rank3 === rank2) + (rank4 === rank2);
  const count3 = rank3 === rank0 || rank3 === rank1 || rank3 === rank2 ? 0 : (rank0 === rank3) + (rank1 === rank3) + (rank2 === rank3) + (rank3 === rank3) + (rank4 === rank3);
  const count4 = rank4 === rank0 || rank4 === rank1 || rank4 === rank2 || rank4 === rank3 ? 0 : (rank0 === rank4) + (rank1 === rank4) + (rank2 === rank4) + (rank3 === rank4) + (rank4 === rank4);
  const maxCount = Math.max(count0, count1, count2, count3, count4);
  const pairCount = Number(count0 === 2) + Number(count1 === 2) + Number(count2 === 2) + Number(count3 === 2) + Number(count4 === 2);

  if (maxCount === 4) return 2;
  if (maxCount === 3 && pairCount === 1) return 3;
  if (maxCount === 3) return 6;
  if (pairCount === 2) return 7;
  if (pairCount === 1) return 8;
  return 9;
}

function evaluateHand(hand) {
  return HAND_RANKS[evaluateEncodedHand(...hand.map((card) => CARD_ID.get(card)))];
}

function countDrawOutcomes(held, remaining, drawCount, tracker) {
  const counts = Array(10).fill(0);
  const [held0, held1, held2, held3, held4] = held;
  const classify = (card0, card1, card2, card3, card4) => {
    counts[evaluateEncodedHand(card0, card1, card2, card3, card4)] += 1;
    if (tracker && ++tracker.completed >= tracker.next) { tracker.next += 50000; tracker.onProgress(tracker.completed, tracker.total); }
  };
  const length = remaining.length;
  if (drawCount === 0) classify(held0, held1, held2, held3, held4);
  if (drawCount === 1) for (let a = 0; a < length; a += 1) classify(held0, held1, held2, held3, remaining[a]);
  if (drawCount === 2) for (let a = 0; a < length - 1; a += 1) for (let b = a + 1; b < length; b += 1) classify(held0, held1, held2, remaining[a], remaining[b]);
  if (drawCount === 3) for (let a = 0; a < length - 2; a += 1) for (let b = a + 1; b < length - 1; b += 1) for (let c = b + 1; c < length; c += 1) classify(held0, held1, remaining[a], remaining[b], remaining[c]);
  if (drawCount === 4) for (let a = 0; a < length - 3; a += 1) for (let b = a + 1; b < length - 2; b += 1) for (let c = b + 1; c < length - 1; c += 1) for (let d = c + 1; d < length; d += 1) classify(held0, remaining[a], remaining[b], remaining[c], remaining[d]);
  if (drawCount === 5) for (let a = 0; a < length - 4; a += 1) for (let b = a + 1; b < length - 3; b += 1) for (let c = b + 1; c < length - 2; c += 1) for (let d = c + 1; d < length - 1; d += 1) for (let e = d + 1; e < length; e += 1) classify(remaining[a], remaining[b], remaining[c], remaining[d], remaining[e]);
  return counts;
}

function solve(hand, onProgress) {
  const handSet = new Set(hand);
  const remaining = deck.filter((card) => !handSet.has(card)).map((card) => CARD_ID.get(card));
  const solutions = [];
  const tracker = onProgress ? { completed: 0, next: 50000, total: 2598960, onProgress } : null;
  for (let mask = 0; mask < 32; mask++) {
    const held = hand.filter((_, index) => mask & (1 << index));
    const discarded = hand.filter((_, index) => !(mask & (1 << index)));
    const encodedCounts = countDrawOutcomes(held.map((card) => CARD_ID.get(card)), remaining, discarded.length, tracker);
    const total = encodedCounts.reduce((sum, value) => sum + value, 0);
    const weighted = encodedCounts.reduce((sum, value, index) => sum + value * PAYOUT_VALUES[index], 0);
    const results = Object.fromEntries(HAND_RANKS.map((name, index) => [name, encodedCounts[index]]));
    solutions.push({ held, discarded, results, totalCases: total, ev: weighted / total, winProbability: (total - encodedCounts[9]) / total });
  }
  if (tracker) tracker.onProgress(tracker.total, tracker.total);
  return solutions.sort((a, b) => b.ev - a.ev || b.winProbability - a.winProbability);
}

function renderSolution(solution) {
  state.activeSolution = solution;
  const renderCards = (id, cards) => { const target = $(id); target.replaceChildren(...cards.map((card) => cardElement(card))); };
  renderCards("hold-cards", solution.held);
  renderCards("change-cards", solution.discarded);
  const profitRate = solution.ev - 1;
  $("ev-value").textContent = `${profitRate >= 0 ? "+" : ""}${(profitRate * 100).toFixed(2)}%`;
  $("ev-value").classList.toggle("profit-positive", profitRate > 0);
  $("ev-value").classList.toggle("profit-negative", profitRate < 0);
  $("win-value").textContent = `${(solution.winProbability * 100).toFixed(4)}%`;
  $("cases-value").textContent = solution.totalCases.toLocaleString("en-US");
  $("strategy-summary").textContent = `${solution.held.length} 张保留 · ${solution.discarded.length} 张更换`;
  const distribution = $("distribution");
  distribution.replaceChildren(...HAND_RANKS.filter((name) => solution.results[name] > 0).map((name) => {
    const percent = solution.results[name] / solution.totalCases * 100;
    const row = document.createElement("div"); row.className = "distribution-row";
    row.innerHTML = `<span>${name}</span><span class="bar-track"><span class="bar" style="width:${percent}%"></span></span><span>${percent.toFixed(4)}%</span>`;
    return row;
  }));
  renderRanking();
}

function renderRanking() {
  const ranking = $("ranking");
  ranking.replaceChildren(...state.solutions.slice(0, 5).map((solution, index) => {
    const row = document.createElement("div"); row.className = `rank-row${solution === state.activeSolution ? " active" : ""}`;
    const profitRate = solution.ev - 1;
    row.innerHTML = `<span class="rank-number">#${index + 1}</span><span class="rank-hold">HOLD ${solution.held.map(cardLabel).join(" ") || "(无)"}</span><span class="rank-ev ${profitRate >= 0 ? "profit-positive" : "profit-negative"}">${profitRate >= 0 ? "+" : ""}${(profitRate * 100).toFixed(2)}%</span>`;
    row.addEventListener("click", () => renderSolution(solution));
    return row;
  }));
}

if (typeof document !== "undefined") {
  const drawWorker = new Worker("draw-worker.js");
  const setDrawProgress = (completed, total) => {
    const percent = completed / total * 100;
    $("draw-progress").classList.remove("hidden");
    $("draw-progress-label").textContent = `已枚举 ${completed.toLocaleString()} / ${total.toLocaleString()} 个终局`;
    $("draw-progress-value").textContent = `${percent.toFixed(1)}%`;
    $("draw-progress-bar").style.width = `${percent}%`;
  };
  drawWorker.addEventListener("message", ({ data }) => {
    if (data.id !== drawRequest) return;
    if (data.type === "progress") { setDrawProgress(data.completed, data.total); return; }
    if (data.type === "result") { state.solutions = data.solutions; renderSolution(state.solutions[0]); $("result-panel").classList.remove("hidden"); $("draw-progress").classList.add("hidden"); $("error-message").textContent = ""; }
    if (data.type === "error") { $("draw-progress").classList.add("hidden"); $("error-message").textContent = data.message; }
  });
  $("clear-button").addEventListener("click", () => { drawRequest += 1; state.hand = []; state.solutions = []; $("result-panel").classList.add("hidden"); $("draw-progress").classList.add("hidden"); $("error-message").textContent = ""; renderHand(); renderDeck(); });
  $("solve-button").addEventListener("click", () => {
    if (state.hand.length !== 5) return;
    drawRequest += 1;
    const requestId = drawRequest;
    setDrawProgress(0, 2598960);
    $("error-message").textContent = "";
    if (window.desktopApi) {
      $("draw-progress-label").textContent = "正在通过 Rust 枚举…";
      $("draw-progress-value").textContent = "计算中";
      $("draw-progress-bar").style.width = "35%";
      window.desktopApi.solveDraw(state.hand).then((solutions) => {
        if (requestId !== drawRequest) return;
        state.solutions = solutions; renderSolution(state.solutions[0]); $("result-panel").classList.remove("hidden"); $("draw-progress").classList.add("hidden");
      }).catch((error) => { if (requestId === drawRequest) { $("draw-progress").classList.add("hidden"); $("error-message").textContent = String(error); } });
      return;
    }
    drawWorker.postMessage({ id: requestId, hand: state.hand });
  });
  renderHand();
  renderDeck();
}
