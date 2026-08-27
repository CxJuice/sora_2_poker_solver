// Game 2 follows the rules documented in game2/game2_rules.md.
// The dealer draws until the hand total reaches 17.

const GAME2_RANKS = "23456789TJQKA";
const GAME2_SUITS = [
  ["C", "♣"], ["D", "♦"], ["H", "♥"], ["S", "♠"],
];
const GAME2_DECK = GAME2_RANKS.split("").flatMap((rank) => GAME2_SUITS.map(([suit]) => rank + suit));
const GAME2_SUIT_SYMBOLS = Object.fromEntries(GAME2_SUITS);
const GAME2_RED_SUITS = new Set(["D", "H"]);
const game2State = { player: [], dealer: [], target: "dealer" };

const game2Get = (id) => document.getElementById(id);

function game2CardLabel(card) {
  return `${card[0] === "T" ? "10" : card[0]}${GAME2_SUIT_SYMBOLS[card[1]]}`;
}

function game2CardImagePath(card) { return `assets/cards/${card}.webp`; }

function game2CardElement(card) {
  const element = document.createElement("div");
  element.className = `card${GAME2_RED_SUITS.has(card[1]) ? " red" : ""}`;
  element.innerHTML = `<img src="${game2CardImagePath(card)}" alt="${game2CardLabel(card)}" draggable="false">`;
  element.title = game2CardLabel(card);
  return element;
}

function game2Score(cards) {
  let total = 0;
  let aces = 0;
  cards.forEach((card) => {
    if (card[0] === "A") aces += 1;
    else if ("TJQK".includes(card[0])) total += 10;
    else total += Number(card[0]);
  });
  total += aces;
  let softAces = 0;
  while (softAces < aces && total + 10 <= 21) {
    total += 10;
    softAces += 1;
  }
  return { total, soft: softAces > 0 };
}

// MDP planner ---------------------------------------------------------------
// Cards are compressed into ten value buckets. This preserves every relevant
// stochastic transition while making exact finite-deck planning fast enough
// for the browser. Suit-specific NATURAL bonuses can only occur on 2 cards,
// so they are retained as a state reward on the initial hand.
const GAME2_VALUES = Array.from({ length: 10 }, (_, index) => index + 1);

function game2CardValue(card) {
  if (card[0] === "A") return 1;
  return "TJQK".includes(card[0]) ? 10 : Number(card[0]);
}

function game2ScoreState(player) {
  const soft = player.aces > 0 && player.hard + 10 <= 21;
  return { total: player.hard + (soft ? 10 : 0), soft };
}

function game2NaturalMultiplier(cards) {
  if (cards.includes("JS") && cards.includes("AS")) return 50;
  if (cards.includes("QD") && cards.includes("AD")) return 10;
  if (cards.some((card) => card[0] === "A") && cards.some((card) => "TJQK".includes(card[0]))) return 3;
  return 2;
}

function game2PlayerFromCards(cards) {
  const values = cards.map(game2CardValue);
  return {
    hard: values.reduce((sum, value) => sum + value, 0),
    aces: values.filter((value) => value === 1).length,
    count: cards.length,
    sevens: values.filter((value) => value === 7).length,
    natural: cards.length === 2 ? game2NaturalMultiplier(cards) : 2,
  };
}

function game2PlayerAfterDraw(player, value) {
  return {
    ...player,
    hard: player.hard + value,
    aces: player.aces + (value === 1 ? 1 : 0),
    count: player.count + 1,
    sevens: player.sevens + (value === 7 ? 1 : 0),
    natural: player.count + 1 === 2 ? player.natural : 2,
  };
}

function game2PayoutMultiplierState(player) {
  const score = game2ScoreState(player);
  if (player.count >= 7 && score.total <= 21) return 250;
  if (player.count === 6 && score.total <= 21) return 120;
  if (player.count === 3 && player.sevens === 3 && score.total === 21) return 100;
  return player.count === 2 ? player.natural : 2;
}

function game2EmptyPlan(stake = 1) {
  return { win: 0, draw: 0, loss: 0, bust: 0, returned: 0, stake, netEv: -stake };
}

function game2TerminalPlan(outcome, multiplier = 0, stake = 1) {
  const plan = game2EmptyPlan(stake);
  plan[outcome] = 1;
  plan.returned = outcome === "win" ? multiplier * stake : outcome === "draw" ? stake : 0;
  plan.netEv = plan.returned - stake;
  return plan;
}

function game2BlendPlans(branches) {
  const result = game2EmptyPlan(0);
  for (const [probability, plan] of branches) {
    result.win += probability * plan.win;
    result.draw += probability * plan.draw;
    result.loss += probability * plan.loss;
    result.bust += probability * plan.bust;
    result.returned += probability * plan.returned;
    result.stake += probability * plan.stake;
  }
  result.netEv = result.returned - result.stake;
  return result;
}

function game2CountsFromKnown(known) {
  const counts = Array(10).fill(0);
  GAME2_DECK.filter((card) => !known.includes(card)).forEach((card) => { counts[game2CardValue(card) - 1] += 1; });
  return counts;
}

function game2CountsKey(counts) { return counts.join(","); }
function game2DrawTransitions(counts) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (!total) return [];
  return GAME2_VALUES.filter((value) => counts[value - 1]).map((value) => {
    const next = [...counts];
    const count = next[value - 1];
    next[value - 1] -= 1;
    return { value, probability: count / total, counts: next };
  });
}

function game2ReportProgress(context) {
  const states = context.policyCache.size + context.dealerCache.size;
  if (context.onProgress && states >= context.nextProgress) { context.nextProgress = states + 1000; context.onProgress(states); }
}

function game2DealerFinish(counts, hard, aces, context) {
  const cache = context.dealerCache;
  const key = `${hard}/${aces}/${game2CountsKey(counts)}`;
  if (cache.has(key)) return cache.get(key);
  const total = hard + (aces > 0 && hard + 10 <= 21 ? 10 : 0);
  const result = Array(22).fill(0);
  if (total > 21) result[0] = 1;
  else if (total >= 17) result[total] = 1;
  else {
    for (const transition of game2DrawTransitions(counts)) {
      const next = game2DealerFinish(transition.counts, hard + transition.value, aces + (transition.value === 1 ? 1 : 0), context);
      next.forEach((probability, index) => { result[index] += transition.probability * probability; });
    }
  }
  cache.set(key, result);
  game2ReportProgress(context);
  return result;
}

function game2DealerFromUpCard(counts, upValue, context) {
  const result = Array(22).fill(0);
  for (const transition of game2DrawTransitions(counts)) {
    const next = game2DealerFinish(transition.counts, upValue + transition.value, (upValue === 1 ? 1 : 0) + (transition.value === 1 ? 1 : 0), context);
    next.forEach((probability, index) => { result[index] += transition.probability * probability; });
  }
  return result;
}

function game2StandPlan(player, counts, upValue, context) {
  const score = game2ScoreState(player);
  if (score.total > 21) return game2TerminalPlan("bust");
  if (player.count >= 7 && score.total < 21) return game2TerminalPlan("win", game2PayoutMultiplierState(player));
  const dealer = game2DealerFromUpCard(counts, upValue, context);
  const plan = game2EmptyPlan(1);
  dealer.forEach((probability, dealerTotal) => {
    if (!probability) return;
    if (dealerTotal === 0 || score.total > dealerTotal) { plan.win += probability; plan.returned += probability * game2PayoutMultiplierState(player); }
    else if (score.total === dealerTotal) { plan.draw += probability; plan.returned += probability; }
    else plan.loss += probability;
  });
  plan.netEv = plan.returned - plan.stake;
  return plan;
}

function game2DoublePlan(player, counts, upValue, context) {
  const branches = game2DrawTransitions(counts).map((transition) => {
    const nextPlayer = game2PlayerAfterDraw(player, transition.value);
    const score = game2ScoreState(nextPlayer);
    if (score.total > 21) return [transition.probability, game2TerminalPlan("bust", 0, 2)];
    const settled = game2StandPlan(nextPlayer, transition.counts, upValue, context);
    return [transition.probability, { ...settled, returned: settled.returned * 2, stake: 2, netEv: settled.returned * 2 - 2 }];
  });
  return branches.length ? game2BlendPlans(branches) : game2StandPlan(player, counts, upValue, context);
}

function game2HitPlan(player, counts, upValue, context) {
  const branches = game2DrawTransitions(counts).map((transition) => [
    transition.probability,
    game2PlanState(game2PlayerAfterDraw(player, transition.value), transition.counts, upValue, context, false).plan,
  ]);
  return branches.length ? game2BlendPlans(branches) : game2StandPlan(player, counts, upValue, context);
}

function game2PlanState(player, counts, upValue, context, canDouble = true) {
  const score = game2ScoreState(player);
  if (score.total > 21) return { action: "bust", plan: game2TerminalPlan("bust") };
  if (player.count >= 7 && score.total < 21) return { action: "win", plan: game2TerminalPlan("win", game2PayoutMultiplierState(player)) };
  if (score.total === 21 || player.count >= 7) return { action: "stand", plan: game2StandPlan(player, counts, upValue, context) };
  const key = `${canDouble ? 1 : 0}/${player.hard}/${player.aces}/${player.count}/${player.sevens}/${player.natural}/${game2CountsKey(counts)}`;
  if (context.policyCache.has(key)) return context.policyCache.get(key);
  const actions = {
    stand: game2StandPlan(player, counts, upValue, context),
    hit: game2HitPlan(player, counts, upValue, context),
  };
  if (canDouble) actions.double = game2DoublePlan(player, counts, upValue, context);
  const action = Object.entries(actions).sort(([, left], [, right]) => right.netEv - left.netEv)[0][0];
  const result = { action, plan: actions[action] };
  context.policyCache.set(key, result);
  game2ReportProgress(context);
  return result;
}

function game2PlanForCards(playerCards, dealerCard, onProgress) {
  const known = [...playerCards, dealerCard];
  const counts = game2CountsFromKnown(known);
  const player = game2PlayerFromCards(playerCards);
  const upValue = game2CardValue(dealerCard);
  const context = { policyCache: new Map(), dealerCache: new Map(), onProgress, nextProgress: 1000 };
  const results = player.count >= 7 || game2ScoreState(player).total === 21
    ? { stand: game2StandPlan(player, counts, upValue, context) }
    : {
      stand: game2StandPlan(player, counts, upValue, context),
      hit: game2HitPlan(player, counts, upValue, context),
      ...(player.count === 2 ? { double: game2DoublePlan(player, counts, upValue, context) } : {}),
    };
  const recommended = Object.entries(results).sort(([, left], [, right]) => right.netEv - left.netEv)[0][0];
  return { results, recommended, policyStates: context.policyCache.size, dealerStates: context.dealerCache.size };
}

function game2PlanInitial() { return game2PlanForCards(game2State.player, game2State.dealer[0]); }

function game2NextHitBustProbability() {
  const known = [...game2State.player, game2State.dealer[0]];
  const remaining = GAME2_DECK.filter((card) => !known.includes(card));
  const busts = remaining.filter((card) => game2Score([...game2State.player, card]).total > 21).length;
  return busts / remaining.length;
}

if (typeof document !== "undefined") {
const game2Worker = window.desktopApi ? null : new Worker("game2-worker.js");
let game2Request = 0;

function game2RenderTargets() {
  game2Get("game2-player-target").classList.toggle("active", game2State.target === "player");
  game2Get("game2-dealer-target").classList.toggle("active", game2State.target === "dealer");
}

function game2RenderHand(id, cards, placeholder) {
  const container = game2Get(id);
  container.replaceChildren();
  if (!cards.length) {
    container.classList.add("empty-state");
    container.textContent = placeholder;
    return;
  }
  container.classList.remove("empty-state");
  cards.forEach((card) => {
    const element = game2CardElement(card);
    element.addEventListener("click", () => game2ToggleCard(card));
    container.appendChild(element);
  });
}

function game2RenderDeck() {
  const selected = new Set([...game2State.player, ...game2State.dealer]);
  const maximumReached = game2State.target === "player" ? game2State.player.length >= 7 : game2State.dealer.length >= 1;
  const container = game2Get("game2-deck");
  container.replaceChildren();
  GAME2_RANKS.split("").forEach((rank) => {
    const group = document.createElement("section");
    group.className = "deck-group";
    group.innerHTML = `<h3 class="deck-group-title">${rank === "T" ? "10" : rank}</h3>`;
    const cards = document.createElement("div");
    cards.className = "deck-group-cards";
    GAME2_DECK.filter((card) => card[0] === rank).forEach((card) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `deck-card${GAME2_RED_SUITS.has(card[1]) ? " red" : ""}${selected.has(card) ? " selected" : ""}`;
      button.disabled = selected.has(card) || maximumReached;
      button.innerHTML = `<img src="${game2CardImagePath(card)}" alt="${game2CardLabel(card)}" loading="lazy" draggable="false">`;
      button.setAttribute("aria-label", game2CardLabel(card));
      button.addEventListener("click", () => game2ToggleCard(card));
      cards.appendChild(button);
    });
    group.appendChild(cards);
    container.appendChild(group);
  });
}

function game2Render() {
  game2RenderTargets();
  game2RenderHand("game2-player-cards", game2State.player, "请选择玩家至少 2 张手牌");
  game2RenderHand("game2-dealer-cards", game2State.dealer, "请选择庄家 1 张明牌");
  game2RenderDeck();
  game2Get("game2-state").textContent = `玩家 ${game2State.player.length} / 7 · 庄家 ${game2State.dealer.length} / 1`;
  game2Get("game2-analyze-button").disabled = game2State.player.length < 2 || game2State.dealer.length !== 1;
}

function game2ToggleCard(card) {
  game2Request += 1;
  const playerIndex = game2State.player.indexOf(card);
  const dealerIndex = game2State.dealer.indexOf(card);
  if (playerIndex >= 0) game2State.player.splice(playerIndex, 1);
  else if (dealerIndex >= 0) {
    game2State.dealer.splice(dealerIndex, 1);
    game2State.target = "dealer";
  }
  else if (game2State.target === "player" && game2State.player.length < 7) game2State.player.push(card);
  else if (game2State.target === "dealer" && game2State.dealer.length < 1) {
    game2State.dealer.push(card);
    game2State.target = "player";
  }
  game2Get("game2-result-panel").classList.add("hidden");
  game2Get("game2-progress").classList.add("hidden");
  game2Get("game2-error").textContent = "";
  game2Render();
}

function game2Percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function game2RenderActionRows(results, recommended) {
  const labels = { stand: "STAND", hit: "HIT", double: "DOUBLE DOWN" };
  const container = game2Get("game2-action-results");
  container.replaceChildren(...Object.entries(results).map(([action, result]) => {
    const row = document.createElement("div");
    row.className = `game2-action-row${action === recommended ? " recommended" : ""}`;
    row.innerHTML = `<span class="game2-action-name">${labels[action]}${action === recommended ? " · 推荐" : ""}</span><span class="game2-action-probability">胜 ${game2Percent(result.win)} · 和 ${game2Percent(result.draw)} · 负 ${game2Percent(result.loss)} · 爆 ${game2Percent(result.bust)}</span><span class="game2-action-ev ${result.netEv >= 0 ? "profit-positive" : "profit-negative"}">${result.netEv >= 0 ? "+" : ""}${(result.netEv * 100).toFixed(2)}%</span>`;
    return row;
  }));
}

function game2RenderFinalResults(plan) {
  const results = [
    ["最终胜利", game2Percent(plan.win)],
    ["最终平局", game2Percent(plan.draw)],
    ["最终失败", game2Percent(plan.loss)],
    ["最终爆牌", game2Percent(plan.bust)],
    ["预期净收益", `${plan.netEv >= 0 ? "+" : ""}${(plan.netEv * 100).toFixed(2)}%`],
  ];
  const container = game2Get("game2-final-results");
  container.replaceChildren(...results.map(([label, value]) => {
    const item = document.createElement("div");
    item.className = "game2-final-result";
    const name = document.createElement("span");
    name.textContent = label;
    const result = document.createElement("strong");
    if (label === "预期净收益") result.classList.add(plan.netEv >= 0 ? "profit-positive" : "profit-negative");
    result.textContent = value;
    item.append(name, result);
    return item;
  }));
}

function game2Analyze() {
  const playerScore = game2Score(game2State.player);
  if (playerScore.total > 21) {
    game2Get("game2-error").textContent = "当前玩家手牌已经超过 21 点，属于 BURST。请修正牌面后再计算。";
    return;
  }
  game2Request += 1;
  const requestId = game2Request;
  game2Get("game2-error").textContent = "";
  game2Get("game2-progress").classList.remove("hidden");
  game2Get("game2-progress-label").textContent = "正在展开有限牌堆 MDP 状态…";
  game2Get("game2-progress-value").textContent = "计算中";
  if (window.desktopApi) {
    game2Get("game2-progress-label").textContent = "正在通过 Rust 规划有限牌堆 MDP…";
    window.desktopApi.solveGame2([...game2State.player], game2State.dealer[0]).then((planned) => {
      if (requestId === game2Request) game2ApplyPlanned(planned);
    }).catch((error) => {
      if (requestId === game2Request) {
        game2Get("game2-progress").classList.add("hidden");
        game2Get("game2-error").textContent = String(error);
      }
    });
    return;
  }
  game2Worker.postMessage({ id: requestId, player: [...game2State.player], dealer: game2State.dealer[0] });
}

function game2ApplyPlanned(planned) {
  const playerScore = game2Score(game2State.player);
  const { results, recommended } = planned;
  const actionNames = { stand: "建议 STAND", hit: "建议 HIT", double: "建议 DOUBLE DOWN" };
  const details = {
    stand: "停止抽牌，按当前点数进入发牌员回合。",
    hit: "抽 1 张后，规划器会根据新牌面和剩余牌堆再次选择期望收益最高的动作。",
    double: "下注变为 2 倍，只抽 1 张牌后进入发牌员回合；已按剩余牌堆枚举。",
  };
  game2Get("game2-recommendation").textContent = actionNames[recommended];
  game2Get("game2-recommendation-detail").textContent = details[recommended];
  game2Get("game2-player-total").textContent = `${playerScore.total}${playerScore.soft ? "（软）" : ""}`;
  game2Get("game2-hit-bust").textContent = game2Percent(game2NextHitBustProbability());
  game2Get("game2-dealer-up").textContent = game2CardLabel(game2State.dealer[0]);
  game2RenderFinalResults(results[recommended]);
  game2RenderActionRows(results, recommended);
  game2Get("game2-result-panel").classList.remove("hidden");
  game2Get("game2-progress").classList.add("hidden");
  game2Get("game2-error").textContent = "";
}

if (game2Worker) game2Worker.addEventListener("message", ({ data }) => {
  if (data.id !== game2Request) return;
  if (data.type === "progress") {
    game2Get("game2-progress-label").textContent = `已展开 ${data.states.toLocaleString()} 个 MDP 状态`;
    return;
  }
  if (data.type === "error") {
    game2Get("game2-progress").classList.add("hidden");
    game2Get("game2-error").textContent = data.message;
    return;
  }
  if (data.type === "result") {
    game2ApplyPlanned(data.planned);
  }
});

function game2SwitchTab(game) {
  game2Get("draw-game").classList.toggle("hidden", game !== "draw");
  game2Get("blackjack-game").classList.toggle("hidden", game !== "blackjack");
  document.querySelectorAll("[data-game-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.gameTab === game));
  game2UpdateTabIndicator();
}

function game2UpdateTabIndicator() {
  const tabs = document.querySelector(".game-tabs");
  const active = tabs?.querySelector(".game-tab.active");
  const indicator = tabs?.querySelector(".game-tab-indicator");
  if (!tabs || !active || !indicator) return;
  indicator.style.left = `${active.offsetLeft}px`;
  indicator.style.width = `${active.offsetWidth}px`;
}

game2Get("game2-player-target").addEventListener("click", () => { game2State.target = "player"; game2Render(); });
game2Get("game2-dealer-target").addEventListener("click", () => { game2State.target = "dealer"; game2Render(); });
game2Get("game2-clear-button").addEventListener("click", () => {
  game2Request += 1;
  game2State.player = []; game2State.dealer = []; game2State.target = "dealer";
  game2Get("game2-result-panel").classList.add("hidden"); game2Get("game2-progress").classList.add("hidden"); game2Get("game2-error").textContent = ""; game2Render();
});
game2Get("game2-analyze-button").addEventListener("click", game2Analyze);
document.querySelectorAll("[data-game-tab]").forEach((tab) => tab.addEventListener("click", () => game2SwitchTab(tab.dataset.gameTab)));
window.addEventListener("resize", game2UpdateTabIndicator);

game2Render();
game2UpdateTabIndicator();
}
