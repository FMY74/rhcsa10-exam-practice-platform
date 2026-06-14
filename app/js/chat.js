/* chat.js — AI 質問チャット（Anthropic Claude を vmbridge 経由で呼ぶ）
   - 履歴は localStorage に問題ごと保存（rhcsa10_chat_v1）
   - mode: "hint" | "explain" | "debug"
   - SSE ストリーミング受信（fetch + ReadableStream）
   - vmbridge 未起動 / chat 未設定の場合は disabled */
(function (global) {
  "use strict";

  var BASE = (typeof global.RHCSA_BRIDGE_BASE === "string"
    && global.RHCSA_BRIDGE_BASE) || "http://127.0.0.1:8770";
  var KEY = "rhcsa10_chat_v1";
  var MAX_TURNS_PER_QID = 40;

  // ---- ストレージ ----
  function loadAll() {
    try { return JSON.parse(global.localStorage.getItem(KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveAll(data) {
    try { global.localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { /* 容量超過等 */ }
  }
  function getHistory(qid) {
    return (loadAll()[qid] || []).slice();
  }
  function setHistory(qid, history) {
    var all = loadAll();
    all[qid] = history.slice(-MAX_TURNS_PER_QID);
    saveAll(all);
  }
  function clearHistory(qid) {
    var all = loadAll();
    delete all[qid];
    saveAll(all);
  }

  // ---- ストリーミング送信 ----
  /* opts:
       qid: "t1q9", mode: "explain"|"hint"|"debug",
       userText: 入力テキスト,
       onChunk: function(text) — 受信した text_delta を逐次受け取る,
       onDone: function(fullReply) — 完了時の全文,
       onError: function(msg) */
  function send(opts) {
    var qid = opts.qid;
    var mode = opts.mode || "explain";
    var userText = (opts.userText || "").trim();
    if (!userText) { opts.onError && opts.onError("メッセージが空です"); return; }

    // 履歴に user メッセージを追加
    var history = getHistory(qid);
    history.push({ role: "user", content: userText, at: Date.now(), mode: mode });
    setHistory(qid, history);

    var token = (global.Bridge && global.Bridge.token) || "";
    var body = JSON.stringify({
      questionId: qid,
      mode: mode,
      // API には role/content だけ送る（at/mode 等はストレージ専用）
      messages: history.map(function (m) {
        return { role: m.role, content: m.content };
      }),
    });

    var fullReply = "";
    var assistantPlaceholder = { role: "assistant", content: "", at: Date.now(), mode: mode, streaming: true };
    history.push(assistantPlaceholder);
    setHistory(qid, history);

    fetch(BASE + "/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RHCSA-Bridge-Token": token,
      },
      body: body,
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (t) {
          var msg = "HTTP " + resp.status;
          try { msg = JSON.parse(t).error || msg; } catch (e) { /* */ }
          throw new Error(msg);
        });
      }
      var reader = resp.body.getReader();
      var decoder = new TextDecoder("utf-8");
      var sseBuf = "";

      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) {
            assistantPlaceholder.content = fullReply;
            assistantPlaceholder.streaming = false;
            setHistory(qid, history);
            opts.onDone && opts.onDone(fullReply);
            return;
          }
          sseBuf += decoder.decode(chunk.value, { stream: true });
          // SSE: イベントは空行（\n\n）で区切られる
          var parts = sseBuf.split("\n\n");
          sseBuf = parts.pop();          // 末尾は次のチャンクと連結
          parts.forEach(function (block) {
            block.split("\n").forEach(function (line) {
              if (line.indexOf("data: ") !== 0) return;
              var payload = line.slice(6);
              try {
                var obj = JSON.parse(payload);
                if (typeof obj.text === "string") {
                  fullReply += obj.text;
                  assistantPlaceholder.content = fullReply;
                  opts.onChunk && opts.onChunk(obj.text);
                }
              } catch (e) { /* event: done など */ }
            });
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      // 失敗 → placeholder を削除して履歴保存
      var idx = history.indexOf(assistantPlaceholder);
      if (idx >= 0) history.splice(idx, 1);
      setHistory(qid, history);
      opts.onError && opts.onError(err.message || String(err));
    });
  }

  // ---- 公開 API ----
  global.Chat = {
    BASE: BASE,
    getHistory: getHistory,
    clearHistory: clearHistory,
    send: send,
    isReady: function () {
      return !!(global.Bridge && global.Bridge.bridgeUp
        && global.Bridge.info && global.Bridge.info.chat);
    },
  };
})(window);
