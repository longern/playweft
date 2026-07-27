local choices = { rock = true, paper = true, scissors = true }

local function reject(code, message)
  return {
    accepted = false,
    error = { code = code, message = message },
  }
end

local function played_players(state)
  local players = {}
  for _, player in ipairs(state.players) do
    if state.choices[player.id] then table.insert(players, player.id) end
  end
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
  return {
    round = 1,
    players = context.players,
    match = context.match,
    choices = {},
  }
end

function on_action(state, action, context)
  if action.type ~= "choose" or not choices[action.choice] then
    return reject("INVALID_CHOICE", "Choose rock, paper, or scissors")
  end
  if state.choices[context.actor.id] then
    return reject("ALREADY_CHOSEN", "A move is already locked in")
  end

  local allowed = false
  for _, player in ipairs(state.players) do
    if player.id == context.actor.id then allowed = true end
  end
  if not allowed then
    return reject("NOT_A_PLAYER", "Spectators cannot choose a move")
  end

  local players = played_players(state)
  if #players >= #state.players then
    return reject("ROUND_FULL", "Every player has already chosen")
  end

  state.choices[context.actor.id] = action.choice
  players = played_players(state)
  if #players < 2 then
    return {
      accepted = true,
      state = state,
      events = { { type = "waiting", player = context.actor.id } },
    }
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
  return {
    accepted = true,
    state = state,
    events = { { type = "revealed", result = state.lastResult } },
  }
end

function view(state, events, context)
  local has_chosen = state.choices[context.viewer.id] ~= nil
  state.choices = {}
  if has_chosen then state.choices[context.viewer.id] = true end

  local visible_events = {}
  for _, event in ipairs(events) do
    if event.type ~= "waiting" or event.player == context.viewer.id then
      table.insert(visible_events, event)
    end
  end
  return { state = state, events = visible_events }
end

function on_return_to_room(state, context)
  return true
end
