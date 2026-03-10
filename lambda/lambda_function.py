import json
import uuid
import io
import re
import string
import boto3
import urllib.parse
import urllib.request
import PyPDF2
from datetime import datetime
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")

users_table = dynamodb.Table("zenbot_users")
sessions_table = dynamodb.Table("zenbot_chat_sessions")
messages_table = dynamodb.Table("zenbot_chat_messages")
login_table = dynamodb.Table("zenbot_login_history")
pdf_table = dynamodb.Table("zenbot_pdf_chunks")


def response(body, status=200):
    return {
        "statusCode": status,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "content-type",
            "Access-Control-Allow-Methods": "POST,OPTIONS"
        },
        "body": json.dumps(body)
    }


def utc_now():
    return datetime.utcnow().isoformat() + "Z"


def get_local_reply(message):
    msg = (message or "").lower().strip()

    if "hello" in msg or "hi" in msg:
        return "Hello! I am ZenBot AI - v2. How can I assist you today?"
    elif "your name" in msg:
        return "My name is ZenBot AI - v2."
    elif "who made you" in msg or "who built you" in msg:
        return "I was built by MD Naimur Rashid, Sourav Chakraborty, and MD Rohan."
    elif "project" in msg:
        return "This project is a serverless chatbot built with S3, API Gateway, Lambda, DynamoDB, and Cognito."
    elif "serverless" in msg:
        return "Serverless means AWS manages the infrastructure, scaling, and runtime for you."
    elif "cloud" in msg:
        return "Cloud computing provides on-demand resources like compute, storage, and networking over the internet."
    elif "help" in msg:
        return "You can ask me about this project, cloud, serverless, AWS, general knowledge topics, or ask questions from a PDF."
    return None


def search_wikipedia(query):
    encoded_query = urllib.parse.quote(query)
    search_url = (
        "https://en.wikipedia.org/w/api.php"
        f"?action=query&list=search&srsearch={encoded_query}&format=json"
    )

    req = urllib.request.Request(
        search_url,
        headers={"User-Agent": "ZenBotAIv2/1.0 (Educational Project)"}
    )

    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode("utf-8"))

    results = data.get("query", {}).get("search", [])
    if not results:
        return None

    return results[0].get("title")


def get_wikipedia_summary(title):
    encoded_title = urllib.parse.quote(title.replace(" ", "_"))
    summary_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded_title}"

    req = urllib.request.Request(
        summary_url,
        headers={"User-Agent": "ZenBotAIv2/1.0 (Educational Project)"}
    )

    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode("utf-8"))

    extract = data.get("extract")
    if not extract:
        return None

    return extract


def clean_query(q):
    words = ["who is", "what is", "where is", "why is", "tell me about"]
    q = q.lower().strip()

    for w in words:
        if q.startswith(w):
            return q.replace(w, "").strip()

    return q


def generate_ai_reply(message):
    local_reply = get_local_reply(message)
    if local_reply:
        return local_reply

    try:
        title = search_wikipedia(clean_query(message))
        if title:
            wiki_summary = get_wikipedia_summary(title)
            if wiki_summary:
                return f"{wiki_summary}\n\n(Source: Wikipedia article: {title})"
    except Exception:
        pass

    return "Sorry, I could not find a good answer for that right now. Please try asking in a clearer way."


def normalize_text(text):
    text = text.lower()
    text = text.translate(str.maketrans("", "", string.punctuation))
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_keywords(question):
    stopwords = {
        "what", "is", "the", "a", "an", "of", "in", "on", "for", "to", "and",
        "who", "where", "why", "how", "when", "which", "tell", "me", "about",
        "are", "was", "were", "do", "does", "did", "from", "by", "with"
    }

    clean_q = normalize_text(question)
    words = clean_q.split()
    keywords = [w for w in words if w not in stopwords and len(w) > 2]
    return keywords


def extract_best_passage(chunk_text, keywords):
    lines = [line.strip() for line in chunk_text.splitlines() if line.strip()]

    best_index = -1
    best_score = 0

    for i, line in enumerate(lines):
        line_lower = normalize_text(line)
        score = sum(1 for kw in keywords if kw in line_lower)

        # Heading bonus
        if any(kw in line_lower for kw in keywords) and len(line.split()) <= 10:
            score += 2

        if score > best_score:
            best_score = score
            best_index = i

    if best_index == -1:
        return chunk_text[:900].strip()

    collected = []
    total_len = 0

    for i in range(best_index, len(lines)):
        line = lines[i]

        # Stop if a new major numbered section starts, but not on the first matched line
        if i > best_index and re.match(r"^\d+[\.\)]?\s+[A-Z]", line):
            break

        collected.append(line)
        total_len += len(line)

        # Enough context collected
        if total_len >= 700:
            break

    passage = " ".join(collected).strip()

    if len(passage) < 120:
        end = min(len(lines), best_index + 8)
        passage = " ".join(lines[best_index:end]).strip()

    return passage[:900]

def normalize_pdf_url(pdf_url):
    # Google Drive share link -> direct download link
    if "drive.google.com" in pdf_url:
        match = re.search(r"/file/d/([^/]+)", pdf_url)
        if match:
            file_id = match.group(1)
            return f"https://drive.google.com/uc?export=download&id={file_id}"

    return pdf_url


def lambda_handler(event, context):
    try:
        method = event.get("requestContext", {}).get("http", {}).get("method", "")

        if method == "OPTIONS":
            return response({"message": "CORS OK"})

        body = json.loads(event.get("body", "{}"))
        action = body.get("action", "send_message")
        user_id = body.get("user_id")

        if not user_id:
            return response({"error": "user_id is required"}, 400)

        # 1) Save login history
        if action == "log_login":
            login_time = utc_now()
            login_table.put_item(
                Item={
                    "user_id": user_id,
                    "login_time": login_time
                }
            )
            return response({"message": "login recorded", "login_time": login_time})

        # 2) Send message / create new chat if needed
        if action == "send_message":
            message = body.get("message", "").strip()
            session_id = body.get("session_id")

            if not message:
                return response({"error": "message is required"}, 400)

            if not session_id:
                session_id = str(uuid.uuid4())
                sessions_table.put_item(
                    Item={
                        "user_id": user_id,
                        "session_id": session_id,
                        "title": message[:40] if message else "New Chat",
                        "created_at": utc_now()
                    }
                )

            reply = generate_ai_reply(message)

            message_id = str(uuid.uuid4())
            messages_table.put_item(
                Item={
                    "session_id": session_id,
                    "message_id": message_id,
                    "user_message": message,
                    "bot_reply": reply,
                    "time": utc_now()
                }
            )

            return response({
                "reply": reply,
                "session_id": session_id
            })

        # 3) Get chat sessions list
        if action == "get_sessions":
            result = sessions_table.query(
                KeyConditionExpression=Key("user_id").eq(user_id)
            )

            sessions = sorted(
                result.get("Items", []),
                key=lambda x: x.get("created_at", ""),
                reverse=True
            )

            return response({"sessions": sessions})

        # 4) Get messages for one session
        if action == "get_messages":
            session_id = body.get("session_id")

            if not session_id:
                return response({"error": "session_id is required"}, 400)

            result = messages_table.query(
                KeyConditionExpression=Key("session_id").eq(session_id)
            )

            messages = sorted(
                result.get("Items", []),
                key=lambda x: x.get("time", "")
            )

            return response({"messages": messages})

        # 5) Get login history
        if action == "get_login_history":
            result = login_table.query(
                KeyConditionExpression=Key("user_id").eq(user_id)
            )

            logins = sorted(
                result.get("Items", []),
                key=lambda x: x.get("login_time", ""),
                reverse=True
            )

            return response({"logins": logins})

        # 6) Save/update user profile
        if action == "save_profile":
            username = body.get("username", "").strip()

            users_table.put_item(
                Item={
                    "user_id": user_id,
                    "username": username,
                    "updated_at": utc_now()
                }
            )

            return response({"message": "profile saved"})

        # 7) Rename chat session
        if action == "rename_session":
            session_id = body.get("session_id")
            new_title = body.get("new_title", "").strip()

            if not session_id or not new_title:
                return response({"error": "session_id and new_title are required"}, 400)

            sessions_table.update_item(
                Key={
                    "user_id": user_id,
                    "session_id": session_id
                },
                UpdateExpression="SET title = :t",
                ExpressionAttributeValues={
                    ":t": new_title
                }
            )

            return response({"message": "session renamed successfully"})

        # 8) Delete chat session and all messages
        if action == "delete_session":
            session_id = body.get("session_id")

            if not session_id:
                return response({"error": "session_id is required"}, 400)

            msg_result = messages_table.query(
                KeyConditionExpression=Key("session_id").eq(session_id)
            )

            for item in msg_result.get("Items", []):
                messages_table.delete_item(
                    Key={
                        "session_id": item["session_id"],
                        "message_id": item["message_id"]
                    }
                )

            sessions_table.delete_item(
                Key={
                    "user_id": user_id,
                    "session_id": session_id
                }
            )

            return response({"message": "session deleted successfully"})

        # 9) Process uploaded PDF
        if action == "process_pdf":
            pdf_url = body.get("pdf_url")

            if not pdf_url:
                return response({"error": "pdf_url required"}, 400)

            pdf_url = normalize_pdf_url(pdf_url)

            req = urllib.request.Request(
                pdf_url,
                headers={"User-Agent": "ZenBotAIv2/1.0 (Educational Project)"}
            )

            with urllib.request.urlopen(req, timeout=20) as res:
                pdf_bytes = res.read()

            reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))

            full_text = ""

            for page in reader.pages:
                text = page.extract_text()
                if text:
                    full_text += text + "\n"

            if not full_text.strip():
                return response({"error": "No extractable text found in PDF"}, 400)

            document_id = str(uuid.uuid4())
            chunk_size = 1200

            chunks = []
            step = 900  # overlap chunking

            for i in range(0, len(full_text), step):
                chunk = full_text[i:i + chunk_size]
                if chunk.strip():
                    chunks.append(chunk)

            for i, chunk in enumerate(chunks):
                pdf_table.put_item(
                    Item={
                        "document_id": document_id,
                        "chunk_id": str(i),
                        "text": chunk
                    }
                )

            return response({
                "message": "PDF processed successfully",
                "document_id": document_id,
                "chunks": len(chunks)
            })

         # 10) Ask question from PDF
        if action == "ask_pdf":
            document_id = body.get("document_id")
            question = body.get("question", "").strip()
            session_id = body.get("session_id")

            if not document_id or not question:
                return response({"error": "document_id and question required"}, 400)

            if not session_id:
                session_id = str(uuid.uuid4())
                sessions_table.put_item(
                    Item={
                        "user_id": user_id,
                        "session_id": session_id,
                        "title": f"[PDF] {question[:34]}",
                        "created_at": utc_now()
                    }
                )

            result = pdf_table.query(
                KeyConditionExpression=Key("document_id").eq(document_id)
            )

            chunks = result.get("Items", [])
            if not chunks:
                return response({
                    "answer": "No document chunks found for this PDF.",
                    "session_id": session_id
                })

            keywords = extract_keywords(question)
            cleaned_question = normalize_text(question)

            best_chunk = ""
            best_score = 0

            for c in chunks:
                text = normalize_text(c["text"])
                score = sum(1 for kw in keywords if kw in text)

                if cleaned_question in text:
                    score += 3

                if score > best_score:
                    best_score = score
                    best_chunk = c["text"]

            if not best_chunk:
                best_chunk = chunks[0]["text"]

            best_passage = extract_best_passage(best_chunk, keywords)
            answer = best_passage[:900]

            message_id = str(uuid.uuid4())
            messages_table.put_item(
                Item={
                    "session_id": session_id,
                    "message_id": message_id,
                    "user_message": f"[PDF] {question}",
                    "bot_reply": answer,
                    "time": utc_now()
                }
            )

            return response({
                "answer": answer,
                "session_id": session_id
            })

        return response({"error": "invalid action"}, 400)

    except Exception as e:
        return response({"error": str(e)}, 500)