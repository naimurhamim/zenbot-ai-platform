const API_URL = "https://pkg3c0wud9.execute-api.us-east-1.amazonaws.com/chat";

const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("appScreen");

const showLoginBtn = document.getElementById("showLoginBtn");
const showSignupBtn = document.getElementById("showSignupBtn");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");

const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");

const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const signupUsername = document.getElementById("signupUsername");
const signupPassword = document.getElementById("signupPassword");

const loginMsg = document.getElementById("loginMsg");
const signupMsg = document.getElementById("signupMsg");

const welcomeText = document.getElementById("welcomeText");
const chatContainer = document.getElementById("chatContainer");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const newChatBtn = document.getElementById("newChatBtn");
const chatHistoryList = document.getElementById("chatHistoryList");
const logoutBtn = document.getElementById("logoutBtn");

const projectPopup = document.getElementById("projectPopup");
const closeProjectPopup = document.getElementById("closeProjectPopup");

const profileBtn = document.getElementById("profileBtn");
const profileModal = document.getElementById("profileModal");
const closeProfileModal = document.getElementById("closeProfileModal");
const profileUsername = document.getElementById("profileUsername");
const profilePassword = document.getElementById("profilePassword");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const profileMsg = document.getElementById("profileMsg");

const viewLoginHistoryBtn = document.getElementById("viewLoginHistoryBtn");
const loginHistoryModal = document.getElementById("loginHistoryModal");
const closeLoginHistoryModal = document.getElementById("closeLoginHistoryModal");
const loginHistoryList = document.getElementById("loginHistoryList");

const pdfUrlInput = document.getElementById("pdfUrlInput");
const processPdfBtn = document.getElementById("processPdfBtn");
const documentIdInput = document.getElementById("documentIdInput");
const askPdfBtn = document.getElementById("askPdfBtn");
const pdfStatusMsg = document.getElementById("pdfStatusMsg");

let currentUser = null;
let currentSessionId = null;

function getUsers() {
  return JSON.parse(localStorage.getItem("zenbot_users_local") || "[]");
}

function saveUsers(users) {
  localStorage.setItem("zenbot_users_local", JSON.stringify(users));
}

function formatDate(iso) {
  try {
    if (!iso) return "";
    const normalized = iso.endsWith("Z") ? iso : iso + "Z";
    return new Date(normalized).toLocaleString();
  } catch {
    return iso;
  }
}

function getCurrentTimeText(iso = null) {
  const dateObj = iso
    ? new Date(iso.endsWith("Z") ? iso : iso + "Z")
    : new Date();

  return dateObj.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function setAuthMode(mode) {
  if (mode === "login") {
    loginForm.classList.remove("hidden");
    signupForm.classList.add("hidden");
    showLoginBtn.classList.add("active");
    showSignupBtn.classList.remove("active");
  } else {
    signupForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
    showSignupBtn.classList.add("active");
    showLoginBtn.classList.remove("active");
  }
}

showLoginBtn.addEventListener("click", () => setAuthMode("login"));
showSignupBtn.addEventListener("click", () => setAuthMode("signup"));

signupBtn.addEventListener("click", () => {
  const username = signupUsername.value.trim();
  const password = signupPassword.value.trim();

  if (!username || !password) {
    signupMsg.textContent = "Please enter username and password.";
    return;
  }

  const users = getUsers();
  const exists = users.find(u => u.username === username);

  if (exists) {
    signupMsg.textContent = "Username already exists.";
    return;
  }

  users.push({
    username,
    password
  });

  saveUsers(users);
  signupMsg.textContent = "Account created successfully. Please login now.";
  signupUsername.value = "";
  signupPassword.value = "";
  setAuthMode("login");
});

loginBtn.addEventListener("click", async () => {
  const username = loginUsername.value.trim();
  const password = loginPassword.value.trim();

  const users = getUsers();
  const user = users.find(u => u.username === username && u.password === password);

  if (!user) {
    loginMsg.textContent = "Invalid username or password.";
    return;
  }

  currentUser = username;
  localStorage.setItem("zenbot_current_user", currentUser);

  try {
    await apiCall({
      action: "log_login",
      user_id: currentUser
    });
  } catch (err) {
    console.error("Login history save failed:", err);
  }

  loginMsg.textContent = "";
  loginUsername.value = "";
  loginPassword.value = "";

  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  welcomeText.textContent = `Logged in as ${currentUser}`;

  documentIdInput.value = localStorage.getItem("zenbot_last_document_id") || "";
  projectPopup.classList.remove("hidden");

  await loadSessions();
  clearChatUI();
  addBotMessage("Welcome! Start a new chat, ask general knowledge questions, or process a study PDF.");
});

closeProjectPopup.addEventListener("click", () => {
  projectPopup.classList.add("hidden");
});

logoutBtn.addEventListener("click", () => {
  currentUser = null;
  currentSessionId = null;
  localStorage.removeItem("zenbot_current_user");
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
});

newChatBtn.addEventListener("click", () => {
  currentSessionId = null;
  clearChatUI();
  addBotMessage("New chat started. Ask me anything.");
  highlightActiveSession(null);
});

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

profileBtn.addEventListener("click", () => {
  profileModal.classList.remove("hidden");
  profileUsername.value = currentUser || "";
  profilePassword.value = "";
  profileMsg.textContent = "";
});

closeProfileModal.addEventListener("click", () => {
  profileModal.classList.add("hidden");
});

saveProfileBtn.addEventListener("click", async () => {
  const newUsername = profileUsername.value.trim();
  const newPassword = profilePassword.value.trim();

  if (!newUsername) {
    profileMsg.textContent = "Username cannot be empty.";
    return;
  }

  const users = getUsers();
  const duplicate = users.find(u => u.username === newUsername && u.username !== currentUser);

  if (duplicate) {
    profileMsg.textContent = "This username is already taken.";
    return;
  }

  const index = users.findIndex(u => u.username === currentUser);

  if (index === -1) {
    profileMsg.textContent = "Current user not found.";
    return;
  }

  const oldUsername = currentUser;
  users[index].username = newUsername;

  if (newPassword) {
    users[index].password = newPassword;
  }

  saveUsers(users);

  currentUser = newUsername;
  localStorage.setItem("zenbot_current_user", currentUser);
  welcomeText.textContent = `Logged in as ${currentUser}`;

  try {
    await apiCall({
      action: "save_profile",
      user_id: currentUser,
      username: currentUser
    });
  } catch (err) {
    console.error("Profile save failed:", err);
  }

  profileMsg.textContent = "Profile updated successfully.";

  if (oldUsername !== currentUser) {
    currentSessionId = null;
    clearChatUI();
    await loadSessions();
  }
});

viewLoginHistoryBtn.addEventListener("click", async () => {
  loginHistoryModal.classList.remove("hidden");
  loginHistoryList.innerHTML = "<div class='login-item'>Loading...</div>";

  try {
    const res = await apiCall({
      action: "get_login_history",
      user_id: currentUser
    });

    loginHistoryList.innerHTML = "";

    const logins = res.logins || [];
    if (!logins.length) {
      loginHistoryList.innerHTML = "<div class='login-item'>No login history found.</div>";
      return;
    }

    logins.forEach(item => {
      const div = document.createElement("div");
      div.className = "login-item";
      div.textContent = formatDate(item.login_time);
      loginHistoryList.appendChild(div);
    });
  } catch (err) {
    loginHistoryList.innerHTML = "<div class='login-item'>Failed to load login history.</div>";
  }
});

closeLoginHistoryModal.addEventListener("click", () => {
  loginHistoryModal.classList.add("hidden");
});

processPdfBtn.addEventListener("click", processPdfFromUrl);
askPdfBtn.addEventListener("click", askQuestionFromPdf);

async function apiCall(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Invalid JSON response from server.");
  }

  if (!res.ok) {
    throw new Error(data.error || data.reply || "API request failed.");
  }

  return data;
}

async function processPdfFromUrl() {
  const pdfUrl = pdfUrlInput.value.trim();

  if (!pdfUrl) {
    pdfStatusMsg.textContent = "Please enter a PDF URL.";
    return;
  }

  if (!currentUser) {
    pdfStatusMsg.textContent = "Please login first.";
    return;
  }

  pdfStatusMsg.textContent = "Processing PDF... Please wait.";

  try {
    const data = await apiCall({
      action: "process_pdf",
      user_id: currentUser,
      pdf_url: pdfUrl
    });

    documentIdInput.value = data.document_id || "";
    localStorage.setItem("zenbot_last_document_id", data.document_id || "");
    pdfStatusMsg.textContent = `PDF processed successfully. Chunks: ${data.chunks}`;
    addBotMessage(`Study PDF processed successfully. Document ID: ${data.document_id}`);
  } catch (err) {
    pdfStatusMsg.textContent = `PDF processing failed: ${err.message}`;
    addBotMessage(`PDF processing failed: ${err.message}`);
  }
}

async function askQuestionFromPdf() {
  const documentId = documentIdInput.value.trim();
  const question = messageInput.value.trim();

  if (!documentId) {
    pdfStatusMsg.textContent = "No document ID found. Process a PDF first.";
    return;
  }

  if (!question) {
    pdfStatusMsg.textContent = "Type a question in the chat box first.";
    return;
  }

  addUserMessage(question);
  messageInput.value = "";
  sendBtn.disabled = true;
  askPdfBtn.disabled = true;
  addTypingIndicator();

  try {
    const data = await apiCall({
      action: "ask_pdf",
      user_id: currentUser,
      document_id: documentId,
      question: question,
      session_id: currentSessionId
    });

    if (data.session_id) {
      currentSessionId = data.session_id;
    }

    removeTypingIndicator();
    addBotMessage(data.answer || "No answer found from PDF.");

    await loadSessions();
    highlightActiveSession(currentSessionId);
  } catch (err) {
    removeTypingIndicator();
    addBotMessage(`PDF answer failed: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
    askPdfBtn.disabled = false;
  }
}

function addUserMessage(text, time = null) {
  const wrapper = document.createElement("div");
  wrapper.className = "user-message";
  wrapper.innerHTML = `
    <div class="avatar">U</div>
    <div>
      <div class="bubble"></div>
      <div class="msg-time">${getCurrentTimeText(time)}</div>
    </div>
  `;
  wrapper.querySelector(".bubble").textContent = text;
  chatContainer.appendChild(wrapper);
  scrollChatToBottom();
}

function addBotMessage(text, time = null) {
  const wrapper = document.createElement("div");
  wrapper.className = "bot-message";
  wrapper.innerHTML = `
    <div class="avatar">Z</div>
    <div>
      <div class="bubble"></div>
      <div class="msg-time">${getCurrentTimeText(time)}</div>
    </div>
  `;
  wrapper.querySelector(".bubble").textContent = text;
  chatContainer.appendChild(wrapper);
  scrollChatToBottom();
}

function addTypingIndicator() {
  const wrapper = document.createElement("div");
  wrapper.className = "bot-message typing-wrap";
  wrapper.id = "typingIndicator";
  wrapper.innerHTML = `
    <div class="avatar">Z</div>
    <div>
      <div class="bubble typing-bubble">
        <span></span><span></span><span></span>
      </div>
      <div class="msg-time">${getCurrentTimeText()}</div>
    </div>
  `;
  chatContainer.appendChild(wrapper);
  scrollChatToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

function clearChatUI() {
  chatContainer.innerHTML = "";
}

function scrollChatToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentUser) return;

  addUserMessage(text);
  messageInput.value = "";
  sendBtn.disabled = true;
  addTypingIndicator();

  try {
    const data = await apiCall({
      action: "send_message",
      user_id: currentUser,
      session_id: currentSessionId,
      message: text
    });

    if (data.session_id) {
      currentSessionId = data.session_id;
    }

    removeTypingIndicator();
    addBotMessage(data.reply || "No response received.");
    await loadSessions();
    highlightActiveSession(currentSessionId);
  } catch (err) {
    removeTypingIndicator();
    addBotMessage(`Error: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
  }
}

async function loadSessions() {
  if (!currentUser) return;

  try {
    const data = await apiCall({
      action: "get_sessions",
      user_id: currentUser
    });

    const sessions = data.sessions || [];
    chatHistoryList.innerHTML = "";

    if (!sessions.length) {
      chatHistoryList.innerHTML = `<div class="history-item">No chats yet</div>`;
      return;
    }

    sessions.forEach(session => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.dataset.sessionId = session.session_id;

      item.innerHTML = `
        <div class="history-top">
          <div class="history-text">
            <strong>${session.title || "Untitled Chat"}</strong><br>
            <small>${formatDate(session.created_at)}</small>
          </div>
          <div class="history-actions">
            <button class="mini-btn rename-btn">✏</button>
            <button class="mini-btn delete-btn">🗑</button>
          </div>
        </div>
      `;

      item.querySelector(".history-text").addEventListener("click", async () => {
        currentSessionId = session.session_id;
        highlightActiveSession(currentSessionId);
        await loadMessages(currentSessionId);
      });

      item.querySelector(".rename-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        const newTitle = prompt("Enter new chat title:", session.title || "Untitled Chat");

        if (!newTitle || !newTitle.trim()) return;

        try {
          await apiCall({
            action: "rename_session",
            user_id: currentUser,
            session_id: session.session_id,
            new_title: newTitle.trim()
          });

          await loadSessions();
          highlightActiveSession(currentSessionId);
        } catch (err) {
          alert("Rename failed: " + err.message);
        }
      });

      item.querySelector(".delete-btn").addEventListener("click", async (e) => {
        e.stopPropagation();

        const ok = confirm("Are you sure you want to delete this chat?");
        if (!ok) return;

        try {
          await apiCall({
            action: "delete_session",
            user_id: currentUser,
            session_id: session.session_id
          });

          if (currentSessionId === session.session_id) {
            currentSessionId = null;
            clearChatUI();
            addBotMessage("Chat deleted. Start a new chat.");
          }

          await loadSessions();
          highlightActiveSession(currentSessionId);
        } catch (err) {
          alert("Delete failed: " + err.message);
        }
      });

      chatHistoryList.appendChild(item);
    });
  } catch (err) {
    chatHistoryList.innerHTML = `<div class="history-item">Failed to load chats</div>`;
  }
}

function highlightActiveSession(sessionId) {
  document.querySelectorAll(".history-item").forEach(item => {
    item.classList.toggle("active", item.dataset.sessionId === sessionId);
  });
}

async function loadMessages(sessionId) {
  clearChatUI();

  try {
    const data = await apiCall({
      action: "get_messages",
      user_id: currentUser,
      session_id: sessionId
    });

    const messages = data.messages || [];

    if (!messages.length) {
      addBotMessage("No messages found in this chat.");
      return;
    }

    messages.forEach(m => {
      addUserMessage(m.user_message, m.time);
      addBotMessage(m.bot_reply, m.time);
    });

    scrollChatToBottom();
  } catch (err) {
    addBotMessage("Failed to load messages.");
  }
}

window.addEventListener("load", async () => {
  const savedUser = localStorage.getItem("zenbot_current_user");
  if (!savedUser) return;

  currentUser = savedUser;
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  welcomeText.textContent = `Logged in as ${currentUser}`;

  documentIdInput.value = localStorage.getItem("zenbot_last_document_id") || "";
  projectPopup.classList.remove("hidden");

  await loadSessions();
  clearChatUI();
  addBotMessage("Welcome back! Select an old chat, ask general knowledge questions, or work with a study PDF.");
});