import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import cors from "cors"
import axios from "axios"

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
})

app.use(cors())

// Store active game rooms
const gameRooms = new Map()
let allFlags = []

// Fetch all flags on startup
async function loadFlags() {
  try {
    const response = await axios.get("https://restcountries.com/v3.1/all?fields=name,flags")
    allFlags = response.data.map((country) => ({
      name: country.name.common,
      flag: country.flags.png || country.flags.svg,
    }))
    console.log(`Loaded ${allFlags.length} flags`)
  } catch (error) {
    console.error("Error loading flags:", error)
  }
}

// Get random unique flags for a game
function getRandomFlags(count) {
  const shuffled = [...allFlags].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

// Get random options for a flag
function getOptionsForFlag(correctCountry) {
  const options = [correctCountry]
  while (options.length < 4) {
    const random = allFlags[Math.floor(Math.random() * allFlags.length)]
    if (!options.includes(random.name)) {
      options.push(random.name)
    }
  }
  return options.sort(() => Math.random() - 0.5)
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id)

  socket.on("create_room", (data) => {
    const roomId = data.roomId
    const playerName = data.playerName

    if (!gameRooms.has(roomId)) {
      gameRooms.set(roomId, {
        players: [],
        currentRound: 0,
        currentPlayerIndex: 0,
        scores: {},
        flags: [],
        gameState: "waiting",
        answered: false,
      })
    }

    const room = gameRooms.get(roomId)

    if (room.players.length < 2) {
      room.players.push({
        id: socket.id,
        name: playerName,
        socketId: socket.id,
      })
      room.scores[socket.id] = 0

      socket.join(roomId)
      socket.emit("room_joined", {
        roomId,
        playerName,
        playerId: socket.id,
        playerCount: room.players.length,
      })

      io.to(roomId).emit("player_joined", {
        playerCount: room.players.length,
        playerName,
      })

      // Start game when 2 players joined
      if (room.players.length === 2) {
        setTimeout(() => {
          startGame(roomId)
        }, 1000)
      }
    } else {
      socket.emit("room_full", { message: "Room is full" })
    }
  })

  socket.on("submit_answer", (data) => {
    const { roomId, answer } = data
    const room = gameRooms.get(roomId)

    if (!room || room.gameState !== "playing" || room.answered) {
      return
    }

    room.answered = true
    const currentFlag = room.flags[room.currentRound]
    const isCorrect = answer === currentFlag.name

    if (isCorrect) {
      room.scores[socket.id]++
    }

    io.to(roomId).emit("answer_result", {
      isCorrect,
      correctAnswer: currentFlag.name,
      playerId: socket.id,
      scores: {
        [room.players[0].id]: room.scores[room.players[0].id],
        [room.players[1].id]: room.scores[room.players[1].id],
      },
    })

    // Move to next round or end game
    setTimeout(() => {
      room.currentRound++
      if (room.currentRound >= 10) {
        endGame(roomId)
      } else {
        room.answered = false
        room.currentPlayerIndex = (room.currentPlayerIndex + 1) % 2
        sendNextFlag(roomId)
      }
    }, 2000)
  })

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id)
    // Clean up room if player disconnects
    for (const [roomId, room] of gameRooms.entries()) {
      const playerIndex = room.players.findIndex((p) => p.id === socket.id)
      if (playerIndex !== -1) {
        io.to(roomId).emit("player_disconnected", {
          playerName: room.players[playerIndex].name,
        })
        gameRooms.delete(roomId)
        break
      }
    }
  })
})

// function startGame(roomId) {
//   const room = gameRooms.get(roomId)
//    if (!room) {
//     console.error(`❌ No room found for code ${roomCode}`)
//     return
//   }
//   room.gameState = "playing"
//   room.flags = getRandomFlags(10)

//   io.to(roomId).emit("game_started", {
//     players: room.players.map((p) => p.name),
//     currentPlayer: room.players[0].name,
//   })

//   sendNextFlag(roomId)
// }

function startGame(roomId) {
  const room = gameRooms.get(roomId)

  // 🛑 Check if the room exists
  if (!room) {
    console.error(`❌ No room found for room ID: ${roomId}`)
    return
  }

  // 🏁 Update room state
  room.gameState = "playing"

  // 🎌 Generate flags for the game
  room.flags = getRandomFlags(10)

  // 🎮 Notify all clients in the room that the game has started
  io.to(roomId).emit("game_started", {
    players: room.players.map((p) => p.name),
    currentPlayer: room.players[0].name,
  })

  // 🚀 Start the first flag round
  sendNextFlag(roomId)

  console.log(`✅ Game started in room ${roomId} with ${room.players.length} players`)
}


function sendNextFlag(roomId) {
  const room = gameRooms.get(roomId)
  const currentFlag = room.flags[room.currentRound]
  const options = getOptionsForFlag(currentFlag.name)
  const currentPlayer = room.players[room.currentPlayerIndex]

  io.to(roomId).emit("next_flag", {
    round: room.currentRound + 1,
    flag: currentFlag.flag,
    options,
    currentPlayerId: currentPlayer.id,
    currentPlayerName: currentPlayer.name,
  })
}

function endGame(roomId) {
  const room = gameRooms.get(roomId)
  room.gameState = "ended"

  const results = room.players.map((player) => ({
    name: player.name,
    score: room.scores[player.id],
  }))

  io.to(roomId).emit("game_over", {
    results,
    winner:
      results[0].score > results[1].score
        ? results[0].name
        : results[1].score > results[0].score
          ? results[1].name
          : "Tie",
  })

  gameRooms.delete(roomId)
}

loadFlags()

const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
