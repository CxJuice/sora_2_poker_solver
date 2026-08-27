use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

const NAMES: [&str; 10] = [
    "Royal Flush",
    "Straight Flush",
    "Four of a Kind",
    "Full House",
    "Flush",
    "Straight",
    "Three of a Kind",
    "Two Pair",
    "One Pair",
    "High Card",
];
const PAYOUT: [u32; 10] = [1000, 100, 50, 15, 10, 8, 4, 3, 2, 0];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DrawSolution {
    held: Vec<String>,
    discarded: Vec<String>,
    results: BTreeMap<String, u32>,
    total_cases: u32,
    ev: f64,
    win_probability: f64,
}

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Game2Plan {
    win: f64,
    draw: f64,
    loss: f64,
    bust: f64,
    returned: f64,
    stake: f64,
    net_ev: f64,
}

#[derive(Clone, Copy)]
struct PlayerState {
    hard: u8,
    aces: u8,
    count: u8,
    sevens: u8,
    natural: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Game2StateResult {
    results: BTreeMap<String, Game2Plan>,
    recommended: String,
    policy_states: usize,
    dealer_states: usize,
}

struct Game2Context {
    policy_cache: HashMap<String, (String, Game2Plan)>,
    dealer_cache: HashMap<String, Vec<f64>>,
    next_progress: usize,
}

fn game2_value(card: &str) -> u8 {
    if card.starts_with('A') {
        1
    } else if "TJQK".contains(card.chars().next().unwrap()) {
        10
    } else {
        card.chars().next().unwrap().to_digit(10).unwrap() as u8
    }
}
fn game2_score(player: PlayerState) -> (u8, bool) {
    let soft = player.aces > 0 && player.hard + 10 <= 21;
    (player.hard + if soft { 10 } else { 0 }, soft)
}
fn game2_empty(stake: f64) -> Game2Plan {
    Game2Plan {
        stake,
        net_ev: -stake,
        ..Default::default()
    }
}
fn game2_terminal(outcome: &str, multiplier: f64, stake: f64) -> Game2Plan {
    let mut p = game2_empty(stake);
    match outcome {
        "win" => {
            p.win = 1.0;
            p.returned = multiplier * stake;
        }
        "draw" => {
            p.draw = 1.0;
            p.returned = stake;
        }
        _ => p.bust = 1.0,
    };
    p.net_ev = p.returned - stake;
    p
}
fn game2_blend(branches: Vec<(f64, Game2Plan)>) -> Game2Plan {
    let mut p = game2_empty(0.0);
    for (q, b) in branches {
        p.win += q * b.win;
        p.draw += q * b.draw;
        p.loss += q * b.loss;
        p.bust += q * b.bust;
        p.returned += q * b.returned;
        p.stake += q * b.stake;
    }
    p.net_ev = p.returned - p.stake;
    p
}
fn game2_counts_key(counts: &[u8; 10]) -> String {
    counts
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",")
}
fn game2_transitions(counts: &[u8; 10]) -> Vec<(u8, f64, [u8; 10])> {
    let total: u8 = counts.iter().sum();
    if total == 0 {
        return vec![];
    }
    (1..=10)
        .filter_map(|value| {
            let n = counts[(value - 1) as usize];
            if n == 0 {
                return None;
            }
            let mut next = *counts;
            next[(value - 1) as usize] -= 1;
            Some((value, n as f64 / total as f64, next))
        })
        .collect()
}
fn game2_report(ctx: &mut Game2Context) {
    let states = ctx.policy_cache.len() + ctx.dealer_cache.len();
    if states >= ctx.next_progress {
        ctx.next_progress = states + 1000;
    }
}

fn game2_dealer_finish(counts: [u8; 10], hard: u8, aces: u8, ctx: &mut Game2Context) -> Vec<f64> {
    let key = format!("{hard}/{aces}/{}", game2_counts_key(&counts));
    if let Some(value) = ctx.dealer_cache.get(&key) {
        return value.clone();
    }
    let total = hard + if aces > 0 && hard + 10 <= 21 { 10 } else { 0 };
    let mut result = vec![0.0; 22];
    if total > 21 {
        result[0] = 1.0;
    } else if total > 17 {
        result[total as usize] = 1.0;
    } else {
        for (value, q, next) in game2_transitions(&counts) {
            let branch = game2_dealer_finish(next, hard + value, aces + u8::from(value == 1), ctx);
            for (i, probability) in branch.iter().enumerate() {
                result[i] += q * probability;
            }
        }
    }
    ctx.dealer_cache.insert(key, result.clone());
    game2_report(ctx);
    result
}
fn game2_dealer_from_up(counts: [u8; 10], up: u8, ctx: &mut Game2Context) -> Vec<f64> {
    let mut result = vec![0.0; 22];
    for (value, q, next) in game2_transitions(&counts) {
        let branch = game2_dealer_finish(
            next,
            up + value,
            u8::from(up == 1) + u8::from(value == 1),
            ctx,
        );
        for (i, probability) in branch.iter().enumerate() {
            result[i] += q * probability;
        }
    }
    result
}
fn game2_payout(player: PlayerState) -> f64 {
    let (total, _) = game2_score(player);
    if player.count >= 7 && total <= 21 {
        250.0
    } else if player.count == 6 && total <= 21 {
        120.0
    } else if player.count == 3 && player.sevens == 3 && total == 21 {
        100.0
    } else if player.count == 2 {
        player.natural
    } else {
        2.0
    }
}
fn game2_stand(player: PlayerState, counts: [u8; 10], up: u8, ctx: &mut Game2Context) -> Game2Plan {
    let (score, _) = game2_score(player);
    if score > 21 {
        return game2_terminal("bust", 0.0, 1.0);
    }
    if player.count >= 7 && score < 21 {
        return game2_terminal("win", game2_payout(player), 1.0);
    }
    let dealer = game2_dealer_from_up(counts, up, ctx);
    let mut p = game2_empty(1.0);
    for (dealer_total, q) in dealer.iter().enumerate() {
        if *q == 0.0 {
            continue;
        }
        if dealer_total == 0 || score as usize > dealer_total {
            p.win += q;
            p.returned += q * game2_payout(player);
        } else if score as usize == dealer_total {
            p.draw += q;
            p.returned += q;
        } else {
            p.loss += q;
        }
    }
    p.net_ev = p.returned - p.stake;
    p
}
fn game2_after_draw(p: PlayerState, value: u8) -> PlayerState {
    PlayerState {
        hard: p.hard + value,
        aces: p.aces + u8::from(value == 1),
        count: p.count + 1,
        sevens: p.sevens + u8::from(value == 7),
        natural: if p.count + 1 == 2 { p.natural } else { 2.0 },
    }
}
fn game2_plan_state(
    player: PlayerState,
    counts: [u8; 10],
    up: u8,
    ctx: &mut Game2Context,
) -> (String, Game2Plan) {
    let (score, _) = game2_score(player);
    if score > 21 {
        return ("bust".into(), game2_terminal("bust", 0.0, 1.0));
    }
    if player.count >= 7 && score < 21 {
        return (
            "win".into(),
            game2_terminal("win", game2_payout(player), 1.0),
        );
    }
    if score == 21 || player.count >= 7 {
        return ("stand".into(), game2_stand(player, counts, up, ctx));
    }
    let key = format!(
        "{}/{}/{}/{}/{}/{}",
        player.hard,
        player.aces,
        player.count,
        player.sevens,
        player.natural,
        game2_counts_key(&counts)
    );
    if let Some(value) = ctx.policy_cache.get(&key) {
        return value.clone();
    }
    let stand = game2_stand(player, counts, up, ctx);
    let hit_branches = game2_transitions(&counts)
        .into_iter()
        .map(|(value, q, next)| {
            let (_, plan) = game2_plan_state(game2_after_draw(player, value), next, up, ctx);
            (q, plan)
        })
        .collect();
    let hit = game2_blend(hit_branches);
    let double_branches = game2_transitions(&counts)
        .into_iter()
        .map(|(value, q, next)| {
            let next_player = game2_after_draw(player, value);
            let (next_score, _) = game2_score(next_player);
            let plan = if next_score > 21 {
                game2_terminal("bust", 0.0, 2.0)
            } else {
                let settled = game2_stand(next_player, next, up, ctx);
                Game2Plan {
                    returned: settled.returned * 2.0,
                    stake: 2.0,
                    net_ev: settled.returned * 2.0 - 2.0,
                    ..settled
                }
            };
            (q, plan)
        })
        .collect();
    let double = game2_blend(double_branches);
    let actions = [("stand", stand), ("hit", hit), ("double", double)];
    let best = actions
        .iter()
        .max_by(|a, b| a.1.net_ev.total_cmp(&b.1.net_ev))
        .unwrap();
    let result = (best.0.to_string(), best.1);
    ctx.policy_cache.insert(key, result.clone());
    game2_report(ctx);
    result
}

fn category(cards: &[u8; 5]) -> usize {
    let mut ranks = [0u8; 5];
    let mut suits = [0u8; 5];
    for (i, card) in cards.iter().enumerate() {
        ranks[i] = card / 4;
        suits[i] = card % 4;
    }
    let flush = suits.iter().all(|s| *s == suits[0]);
    let mut counts = [0u8; 13];
    let mut mask = 0u16;
    for rank in ranks {
        counts[rank as usize] += 1;
        mask |= 1 << rank;
    }
    let straight = mask == 0b1_0000_0000_1111 || (0..9).any(|start| mask == 0b1_1111 << start);
    if flush && straight {
        return if mask == 0b1_1111 << 8 { 0 } else { 1 };
    }
    let mut multiplicities: Vec<u8> = counts.into_iter().filter(|count| *count > 0).collect();
    multiplicities.sort_unstable_by(|a, b| b.cmp(a));
    match multiplicities.as_slice() {
        [4, 1] => 2,
        [3, 2] => 3,
        _ if flush => 4,
        _ if straight => 5,
        [3, 1, 1] => 6,
        [2, 2, 1] => 7,
        [2, 1, 1, 1] => 8,
        _ => 9,
    }
}

fn enumerate(
    remaining: &[u8],
    need: usize,
    start: usize,
    picked: &mut Vec<u8>,
    held: &[u8],
    counts: &mut [u32; 10],
) {
    if picked.len() == need {
        let mut final_cards = [0u8; 5];
        for (i, card) in held.iter().chain(picked.iter()).enumerate() {
            final_cards[i] = *card;
        }
        counts[category(&final_cards)] += 1;
        return;
    }
    for index in start..=remaining.len() - (need - picked.len()) {
        picked.push(remaining[index]);
        enumerate(remaining, need, index + 1, picked, held, counts);
        picked.pop();
    }
}

#[tauri::command]
fn solve_draw(hand: Vec<String>) -> Result<Vec<DrawSolution>, String> {
    if hand.len() != 5 {
        return Err("需要恰好 5 张不同手牌".into());
    }
    let ranks = b"23456789TJQKA";
    let suits = b"CDHS";
    let deck: Vec<String> = ranks
        .iter()
        .flat_map(|rank| {
            suits
                .iter()
                .map(move |suit| format!("{}{}", *rank as char, *suit as char))
        })
        .collect();
    if hand.iter().any(|card| !deck.contains(card))
        || hand.iter().collect::<std::collections::HashSet<_>>().len() != 5
    {
        return Err("手牌格式无效或存在重复".into());
    }
    let ids: Vec<u8> = hand
        .iter()
        .map(|card| deck.iter().position(|value| value == card).unwrap() as u8)
        .collect();
    let remaining: Vec<u8> = (0..52)
        .filter(|card| !ids.contains(&(*card as u8)))
        .map(|card| card as u8)
        .collect();
    let mut solutions = Vec::new();
    for mask in 0..32u8 {
        let held_indices: Vec<usize> = (0..5).filter(|index| mask & (1 << index) != 0).collect();
        let held: Vec<String> = held_indices
            .iter()
            .map(|index| hand[*index].clone())
            .collect();
        let discarded: Vec<String> = (0..5)
            .filter(|index| !held_indices.contains(index))
            .map(|index| hand[index].clone())
            .collect();
        let held_ids: Vec<u8> = held_indices.iter().map(|index| ids[*index]).collect();
        let mut counts = [0u32; 10];
        enumerate(
            &remaining,
            discarded.len(),
            0,
            &mut Vec::new(),
            &held_ids,
            &mut counts,
        );
        let total: u32 = counts.iter().sum();
        let weighted: u32 = counts
            .iter()
            .zip(PAYOUT)
            .map(|(count, payout)| count * payout)
            .sum();
        let results = NAMES
            .iter()
            .zip(counts)
            .map(|(name, count)| ((*name).to_string(), count))
            .collect();
        solutions.push(DrawSolution {
            held,
            discarded,
            results,
            total_cases: total,
            ev: weighted as f64 / total as f64,
            win_probability: (total - counts[9]) as f64 / total as f64,
        });
    }
    solutions.sort_by(|left, right| {
        right
            .ev
            .total_cmp(&left.ev)
            .then_with(|| right.win_probability.total_cmp(&left.win_probability))
    });
    Ok(solutions)
}

#[tauri::command]
fn solve_game2(player: Vec<String>, dealer: String) -> Result<Game2StateResult, String> {
    let deck: Vec<String> = b"23456789TJQKA"
        .iter()
        .flat_map(|rank| {
            b"CDHS"
                .iter()
                .map(move |suit| format!("{}{}", *rank as char, *suit as char))
        })
        .collect();
    if player.len() < 2
        || player.len() > 7
        || !deck.contains(&dealer)
        || player.iter().any(|card| !deck.contains(card))
    {
        return Err("玩家手牌必须为 2-7 张，且牌面格式有效".into());
    }
    let mut known = player.clone();
    known.push(dealer.clone());
    if known.iter().collect::<HashSet<_>>().len() != known.len() {
        return Err("牌面不能重复".into());
    }
    let mut counts = [0u8; 10];
    for card in deck.iter().filter(|card| !known.contains(card)) {
        counts[(game2_value(card) - 1) as usize] += 1;
    }
    let mut hard = 0u8;
    let mut aces = 0u8;
    let mut sevens = 0u8;
    for card in &player {
        let value = game2_value(card);
        hard += value;
        aces += u8::from(value == 1);
        sevens += u8::from(value == 7);
    }
    let natural = if player.len() == 2 {
        if player.contains(&"JS".into()) && player.contains(&"AS".into()) {
            50.0
        } else if player.contains(&"QD".into()) && player.contains(&"AD".into()) {
            10.0
        } else if player.iter().any(|card| card.starts_with('A'))
            && player
                .iter()
                .any(|card| "TJQK".contains(card.chars().next().unwrap()))
        {
            3.0
        } else {
            2.0
        }
    } else {
        2.0
    };
    let state = PlayerState {
        hard,
        aces,
        count: player.len() as u8,
        sevens,
        natural,
    };
    let up = game2_value(&dealer);
    let mut context = Game2Context {
        policy_cache: HashMap::new(),
        dealer_cache: HashMap::new(),
        next_progress: 1000,
    };
    let mut results: BTreeMap<String, Game2Plan> = BTreeMap::new();
    if state.count >= 7 || game2_score(state).0 == 21 {
        results.insert("stand".into(), game2_stand(state, counts, up, &mut context));
    } else {
        results.insert("stand".into(), game2_stand(state, counts, up, &mut context));
        let hit_branches = game2_transitions(&counts)
            .into_iter()
            .map(|(value, q, next)| {
                let (_, plan) =
                    game2_plan_state(game2_after_draw(state, value), next, up, &mut context);
                (q, plan)
            })
            .collect();
        results.insert("hit".into(), game2_blend(hit_branches));
        let double_branches = game2_transitions(&counts)
            .into_iter()
            .map(|(value, q, next)| {
                let next_player = game2_after_draw(state, value);
                let plan = if game2_score(next_player).0 > 21 {
                    game2_terminal("bust", 0.0, 2.0)
                } else {
                    let settled = game2_stand(next_player, next, up, &mut context);
                    Game2Plan {
                        returned: settled.returned * 2.0,
                        stake: 2.0,
                        net_ev: settled.returned * 2.0 - 2.0,
                        ..settled
                    }
                };
                (q, plan)
            })
            .collect();
        results.insert("double".into(), game2_blend(double_branches));
    }
    let recommended = ["stand", "hit", "double"]
        .iter()
        .filter_map(|name| results.get_key_value(*name))
        .max_by(|a, b| a.1.net_ev.total_cmp(&b.1.net_ev))
        .map(|(name, _)| name.clone())
        .unwrap();
    Ok(Game2StateResult {
        results,
        recommended,
        policy_states: context.policy_cache.len(),
        dealer_states: context.dealer_cache.len(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![solve_draw, solve_game2])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}
