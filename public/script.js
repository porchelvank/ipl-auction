
const socket = io();

let auctionState = null;
let selectedTeam = localStorage.getItem("iplTeam") || "";

const teamSelect = document.getElementById("teamSelect");
const bidButton = document.getElementById("bidButton");

teamSelect.value = selectedTeam;

// Format auction price
function money(value) {
    return "₹" + Number(value || 0).toFixed(2) + " Cr";
}

// Select team
function selectTeam() {
    const newTeam = teamSelect.value;

    if (!newTeam) {
        selectedTeam = "";
        localStorage.removeItem("iplTeam");

        document.getElementById("selectedMessage").textContent =
            "Select your team to participate in bidding.";

        render();
        return;
    }

    selectedTeam = newTeam;
    localStorage.setItem("iplTeam", selectedTeam);

    socket.emit("joinTeam", selectedTeam);

    document.getElementById("selectedMessage").textContent =
        "Connecting to " + selectedTeam + "...";

    render();
}

teamSelect.addEventListener("change", selectTeam);

// Reconnect to server
socket.on("connect", () => {
    if (selectedTeam) {
        socket.emit("joinTeam", selectedTeam);
    }
});

// Connection status
socket.on("disconnect", () => {
    document.getElementById("selectedMessage").textContent =
        "Disconnected. Reconnecting...";
});

// Team successfully joined
socket.on("teamJoined", data => {
    if (data && data.team) {
        selectedTeam = data.team;
        localStorage.setItem("iplTeam", selectedTeam);

        teamSelect.value = selectedTeam;

        document.getElementById("selectedMessage").textContent =
            "Connected as " + data.team;
    }
});

// Receive auction updates
socket.on("auctionUpdate", data => {
    auctionState = data;
    render();
});

// Receive server errors
socket.on("auctionError", message => {
    alert(message);

    // If the server rejects the selected team,
    // clear the local selection so another team can be chosen.
    selectedTeam = "";
    localStorage.removeItem("iplTeam");
    teamSelect.value = "";

    document.getElementById("selectedMessage").textContent =
        "Team selection failed. Please select an available team.";

    render();
});

// Place bid
bidButton.addEventListener("click", () => {
    if (!selectedTeam) {
        alert("Please select your team!");
        return;
    }

    if (!auctionState || auctionState.status !== "LIVE") {
        alert("Auction is not live!");
        return;
    }

    socket.emit("placeBid");
});

// Main render function
function render() {
    if (!auctionState) return;

    const s = auctionState;
    const player = s.currentPlayer;

    // Current player details
    if (player) {
        document.getElementById("playerName").textContent =
            player.name;

        document.getElementById("playerRole").textContent =
            player.role;

        document.getElementById("currentBid").textContent =
            money(s.currentBid);

        document.getElementById("playerNumber").textContent =
            "PLAYER " + (s.currentIndex + 1) + " / 100";
    } else {
        document.getElementById("playerName").textContent =
            s.finished ? "AUCTION COMPLETED" : "Waiting...";

        document.getElementById("playerRole").textContent = "-";
        document.getElementById("currentBid").textContent =
            money(s.currentBid);
    }

    // Highest bidder
    document.getElementById("highestBidder").textContent =
        s.highestBidder
            ? "Highest Bidder: " + s.highestBidder
            : "No bids yet";

    // Auction status
    const status = document.getElementById("auctionStatus");

    status.textContent = s.status;

    status.className = "status " +
        (s.status === "SOLD" ? "green" :
        s.status === "UNSOLD" ? "red" : "green");

    // Check whether the selected team can bid
    const team = selectedTeam ? s.teams[selectedTeam] : null;

    const nextBid = s.highestBidder
        ? Number(s.currentBid) + 0.05
        : Number(s.currentBid);

    const canBid =
        s.status === "LIVE" &&
        !!team &&
        team.squad.length < 25 &&
        s.highestBidder !== selectedTeam &&
        Number(team.purse) >= nextBid;

    bidButton.disabled = !canBid;

    bidButton.textContent = canBid
        ? "🔨 BID " + money(nextBid)
        : "BIDDING UNAVAILABLE";

    // Update dashboard and lists
    renderTeams();
    renderPlayers();
    renderHistory();

    // Auction progress
    const completed =
        (s.soldPlayers || []).length +
        (s.unsoldPlayers || []).length;

    document.getElementById("progress").textContent =
        completed + " / 100 Players Completed";

    document.getElementById("progressBar").style.width =
        (completed / 100 * 100) + "%";
}

// Render team dashboard
function renderTeams() {
    const container =
        document.getElementById("teamsContainer");

    container.innerHTML = "";

    Object.values(auctionState.teams || {}).forEach(team => {
        const div = document.createElement("div");
        div.className = "team";

        const title = document.createElement("h3");
        title.textContent = team.id;

        const purse = document.createElement("p");
        purse.textContent = "Purse: " + money(team.purse);

        const count = document.createElement("p");
        count.textContent = "Players: " + team.squad.length;

        const players = document.createElement("p");
        players.textContent =
            "Squad: " +
            (team.squad.map(p => p.name).join(", ") || "Empty");

        div.append(title, purse, count, players);
        container.appendChild(div);
    });
}

// Render sold and unsold players
function renderPlayers() {
    const sold = document.getElementById("soldList");
    const unsold = document.getElementById("unsoldList");

    sold.innerHTML = "";
    unsold.innerHTML = "";

    (auctionState.soldPlayers || []).slice().reverse().forEach(p => {
        const item = document.createElement("div");
        item.className = "list-item";

        item.textContent =
            p.name + " — " + p.team + " — " + money(p.soldPrice);

        sold.appendChild(item);
    });

    (auctionState.unsoldPlayers || []).slice().reverse().forEach(p => {
        const item = document.createElement("div");
        item.className = "list-item";
        item.textContent = p.name + " — UNSOLD";

        unsold.appendChild(item);
    });

    if (!(auctionState.soldPlayers || []).length) {
        sold.textContent = "No players sold yet.";
    }

    if (!(auctionState.unsoldPlayers || []).length) {
        unsold.textContent = "No unsold players yet.";
    }
}

// Render auction history
function renderHistory() {
    const container = document.getElementById("historyList");

    container.innerHTML = "";

    (auctionState.history || []).slice().reverse().forEach(item => {
        const div = document.createElement("div");
        div.className = "list-item";

        div.textContent =
            item.player + " | " +
            item.result + " | " +
            (item.team || "-") + " | " +
            money(item.price);

        container.appendChild(div);
    });

    if (!(auctionState.history || []).length) {
        container.textContent = "No history yet.";
    }
}

// Update auction timer
function updateTimer() {
    const timer = document.getElementById("timer");

    if (!auctionState || !auctionState.endsAt) {
        timer.textContent = "--";
        timer.style.color = "#52e6a0";
        return;
    }

    const remaining = Math.max(
        0,
        Math.ceil((auctionState.endsAt - Date.now()) / 1000)
    );

    timer.textContent = remaining;

    timer.style.color =
        remaining <= 5 ? "#ff7373" : "#52e6a0";
}

// Update timer every 250 milliseconds
setInterval(updateTimer, 250);
