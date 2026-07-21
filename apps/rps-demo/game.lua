local choices = { rock = true, paper = true, scissors = true }

local function sorted_players(played)
  local players = {}
  for player_id, _ in pairs(played) do table.insert(players, player_id) end
  table.sort(players)
  return players
end

local function winner(a, b)
  if a == b then return nil end
  if (a == "rock" and b == "scissors") or (a == "paper" and b == "rock") or (a == "scissors" and b == "paper") then
    return 1
  end
  return 2
end

function setup(context)
  return { round = 1, players = context.players, choices = {} }
end

function on_action(state, action, context)
  if action.type ~= "choose" or not choices[action.choice] then
    return { state = state, events = { { type = "invalid_choice" } } }
  end
  if state.choices[context.playerId] then
    return { state = state, events = { { type = "already_chosen" } } }
  end

  local allowed = false
  for _, player_id in ipairs(state.players) do
    if player_id == context.playerId then allowed = true end
  end
  if not allowed then
    return { state = state, events = { { type = "not_a_player" } } }
  end

  local players = sorted_players(state.choices)
  if #players >= #state.players then
    return { state = state, events = { { type = "room_full" } } }
  end

  state.choices[context.playerId] = action.choice
  players = sorted_players(state.choices)
  if #players < 2 then
    return { state = state, events = { { type = "waiting", player = context.playerId } } }
  end

  local first, second = players[1], players[2]
  local first_choice, second_choice = state.choices[first], state.choices[second]
  local winner_index = winner(first_choice, second_choice)
  state.lastResult = {
    round = state.round,
    players = players,
    choices = { first_choice, second_choice },
    draw = winner_index == nil,
    winner = winner_index and players[winner_index] or nil,
  }
  state.round = state.round + 1
  state.choices = {}
  return { state = state, events = { { type = "revealed", result = state.lastResult } } }
end

function on_return_to_room(state, context)
  return true
end
