const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const players = require("./player");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TIMER = Number(process.env.AUCTION_TIMER || 20);
const BASE_PRICE = Number(process.env.BASE_PRICE || 0.20);
const TEAM_PURSE = Number(process.env.TEAM_PURSE || 120);

const DATA_DIR = process.env.DATA_DIR || __dirname;

fs.mkdirSync(DATA_DIR, { recursive: true });

const DATA_FILE = path.join(DATA_DIR, "auction-data.json");

const TEAM_NAMES = ["CSK", "MI", "RCB", "RR"];

function freshState() {
    return {
        teams: Object.fromEntries(
            TEAM_NAMES.map(id => [
                id,
                {
                    id,
                    purse: TEAM_PURSE,
                    squad: []
                }
            ])
        ),
        currentIndex: -1,
        currentPlayer: null,
        currentBid: 0,
        highestBidder: null,
        status: "WAITING",
        endsAt: null,
        soldPlayers: [],
        unsoldPlayers: [],
        history: [],
        started: false,
        finished: false
    };
}

function loadState() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(
                fs.readFileSync(DATA_FILE, "utf8")
            );
        }
    } catch (error) {
        console.error("State loading error:", error);
    }

    return freshState();
}

let state = loadState();

let auctionTimer = null;
let nextTimer = null;

function saveState() {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(state, null, 2)
    );
}

function sendState() {
    io.emit("auctionUpdate", state);
}

function round(value) {
    return Math.round(
        (value + Number.EPSILON) * 100
    ) / 100;
}

function startNextPlayer() {
    clearTimeout(auctionTimer);
    clearTimeout(nextTimer);

    if (state.currentIndex + 1 >= players.length) {
        state.currentPlayer = null;
        state.status = "COMPLETED";
        state.finished = true;
        state.endsAt = null;

        saveState();
        sendState();
        return;
    }

    state.currentIndex++;

    const player = players[state.currentIndex];

    state.currentPlayer = player;
    state.currentBid = round(
        player.basePrice || BASE_PRICE
    );

    state.highestBidder = null;
    state.status = "LIVE";
    state.endsAt = Date.now() + TIMER * 1000;

    saveState();
    sendState();

    scheduleSettlement();
}

function scheduleSettlement() {
    clearTimeout(auctionTimer);

    if (
        state.status !== "LIVE" ||
        !state.endsAt
    ) return;

    const remaining = Math.max(
        0,
        state.endsAt - Date.now()
    );

    auctionTimer = setTimeout(
        settleAuction,
        remaining
    );
}

function settleAuction() {
    if (state.status !== "LIVE") return;

    const player = state.currentPlayer;

    if (!player) return;

    if (state.highestBidder) {
        const team = state.teams[state.highestBidder];

        if (!team) return;

        team.purse = round(
            team.purse - state.currentBid
        );

        team.squad.push({
            ...player,
            soldPrice: state.currentBid
        });

        state.soldPlayers.push({
            ...player,
            team: team.id,
            soldPrice: state.currentBid
        });

        state.status = "SOLD";

    } else {
        state.unsoldPlayers.push(player);
        state.status = "UNSOLD";
    }

    state.history.push({
        player: player.name,
        result: state.status,
        team: state.highestBidder,
        price: state.highestBidder
            ? state.currentBid
            : 0,
        time: new Date().toISOString()
    });

    state.endsAt = null;

    saveState();
    sendState();

    nextTimer = setTimeout(
        startNextPlayer,
        2500
    );
}

function startAuction() {
    if (state.started || state.finished) return;

    state.started = true;

    saveState();

    startNextPlayer();
}

// Static website
app.use(express.static(
    path.join(__dirname, "public")
));

// API
app.get("/api/state", (req, res) => {
    res.json(state);
});

app.get("/api/players", (req, res) => {
    res.json(players);
});

// Socket.IO
io.on("connection", socket => {

    console.log("User connected:", socket.id);

    socket.emit("auctionUpdate", state);

    socket.on("joinTeam", teamId => {

        if (!TEAM_NAMES.includes(teamId)) {
            socket.emit(
                "auctionError",
                "Invalid team!"
            );
            return;
        }

        socket.data.teamId = teamId;

        socket.emit("teamJoined", {
            team: teamId
        });

    });

    socket.on("placeBid", () => {

        const teamId = socket.data.teamId;

        if (!teamId) {
            socket.emit(
                "auctionError",
                "Select your team first!"
            );
            return;
        }

        if (state.status !== "LIVE") {
            socket.emit(
                "auctionError",
                "Auction is not live!"
            );
            return;
        }

        const team = state.teams[teamId];

        if (!team) return;

        if (team.squad.length >= 25) {
            socket.emit(
                "auctionError",
                "Squad limit reached!"
            );
            return;
        }

        if (state.highestBidder === teamId) {
            socket.emit(
                "auctionError",
                "You are already the highest bidder!"
            );
            return;
        }

        const bidAmount = state.highestBidder
            ? round(state.currentBid + 0.05)
            : round(state.currentBid);

        if (team.purse < bidAmount) {
            socket.emit(
                "auctionError",
                "Insufficient purse!"
            );
            return;
        }

        state.currentBid = bidAmount;
        state.highestBidder = teamId;

        // Reset timer after every valid bid
        state.endsAt = Date.now() + TIMER * 1000;

        saveState();
        sendState();

        scheduleSettlement();

    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });

});

// Start server
server.listen(PORT, "0.0.0.0", () => {

    console.log("--------------------------------");
    console.log(" IPL AUCTION PRO STARTED");
    console.log("--------------------------------");

    console.log(`Port: ${PORT}`);
    console.log(`Players: ${players.length}`);
    console.log(`Teams: ${TEAM_NAMES.join(", ")}`);
    console.log(`Timer: ${TIMER} seconds`);

    console.log("--------------------------------");

    if (state.finished) {

        console.log("Auction already completed.");

    } else if (state.status === "LIVE") {

        scheduleSettlement();

    } else if (
        state.status === "SOLD" ||
        state.status === "UNSOLD"
    ) {

        nextTimer = setTimeout(
            startNextPlayer,
            2500
        );

    } else {

        setTimeout(startAuction, 3000);

    }

});