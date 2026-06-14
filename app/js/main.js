/* main.js — アプリのブートストラップ・ハッシュルーティング・模擬試験セッション/タイマー管理 */
(function (global) {
  "use strict";

  var appEl = document.getElementById("app");
  var timerEl = document.getElementById("exam-timer");
  var bridgeEl = document.getElementById("bridge-status");
  var EXAM_SESSION_KEY = "rhcsa10_examsession_v1";

  var App = {
    session: null,       // ドリル/ランダム/復習: {mode,label,baseHash,list}
    examSession: null,   // 模擬試験ランタイム状態
    lastExamResult: null,
    _timerId: null,

    // ---- 描画 ----
    mount: function (res) {
      appEl.innerHTML = res.html;
      if (res.bind) res.bind(appEl);
      appEl.querySelectorAll("[data-hash]").forEach(function (el) {
        el.addEventListener("click", function () {
          location.hash = el.getAttribute("data-hash");
        });
      });
      // 全 <pre> にコピーボタンを動的注入（採点補助・解答・コマンドリファレンス共通）
      attachCopyButtons(appEl);
      global.scrollTo(0, 0);
    },

    render: function () {
      var hash = location.hash.replace(/^#/, "") || "home";
      var parts = hash.split("/");
      var route = parts[0];
      setActiveNav(route);
      var res;
      try {
        switch (route) {
          case "home": res = Screens.home(); break;
          case "exam": res = Screens.examList(); break;
          case "exam-run": res = examRunGuarded(parts[1]); break;
          case "exam-result": res = Screens.examResult(); break;
          case "drill":
            res = parts[1] ? Screens.drillList(parts[1]) : Screens.drillGrid();
            break;
          case "random": res = Screens.randomSetup(parts[1]); break;
          case "q": res = Screens.question(parts[1]); break;
          case "guides": res = Screens.guidesList(); break;
          case "guide": res = Screens.guide(parts.slice(1).join("/")); break;
          case "history": res = Screens.history(); break;
          default: res = Screens.notFound("不明なページ: " + hash);
        }
      } catch (e) {
        console.error(e);
        res = Screens.notFound("画面の描画でエラーが発生しました: " + e.message);
      }
      // res が null のときは mount をスキップ（exam 切替の confirm キャンセルで
      // 画面が一瞬白くなるのを防ぐ。後続の hashchange 経由で再描画される）
      if (res) App.mount(res);
      App.updateTimerDisplay();
    },

    // ---- 模擬試験セッション ----
    startExam: function (exam) {
      var now = Date.now();
      App.examSession = {
        examId: exam.id, name: exam.name,
        startedAt: now, endsAt: now + exam.timeLimit * 1000,
        timeLimit: exam.timeLimit,
        totalScore: exam.totalScore, passScore: exam.passScore,
        index: 0, submitted: false,
        tasks: exam.tasks.map(function (t) {
          return {
            qid: t.questionId, points: t.points,
            answer: "", revealed: false, selfGrade: null
          };
        })
      };
      App.saveExam();
      App.startTimer();
    },

    saveExam: function () {
      try {
        if (App.examSession)
          global.sessionStorage.setItem(EXAM_SESSION_KEY,
            JSON.stringify(App.examSession));
        else
          global.sessionStorage.removeItem(EXAM_SESSION_KEY);
      } catch (e) { /* sessionStorage 不可でも続行 */ }
    },

    restoreExam: function () {
      try {
        var raw = global.sessionStorage.getItem(EXAM_SESSION_KEY);
        if (!raw) return;
        var s = JSON.parse(raw);
        if (s && !s.submitted && Date.now() < s.endsAt) {
          App.examSession = s;
          App.startTimer();
        } else {
          global.sessionStorage.removeItem(EXAM_SESSION_KEY);
        }
      } catch (e) { /* 無視 */ }
    },

    startTimer: function () {
      App.stopTimer();
      App._timerId = global.setInterval(function () {
        if (!App.examSession || App.examSession.submitted) {
          App.stopTimer(); return;
        }
        if (Date.now() >= App.examSession.endsAt) {
          App.finalizeExam({ timeout: true, mode: "self" }); return;
        }
        App.updateTimerDisplay();
      }, 1000);
    },

    stopTimer: function () {
      if (App._timerId) { global.clearInterval(App._timerId); App._timerId = null; }
    },

    updateTimerDisplay: function () {
      var S = App.examSession;
      if (!S || S.submitted) {
        timerEl.classList.add("hidden");
        timerEl.innerHTML = "";
        timerEl._examId = null;
        return;
      }
      var rem = Math.max(0, Math.floor((S.endsAt - Date.now()) / 1000));
      var h = Math.floor(rem / 3600);
      var m = Math.floor((rem % 3600) / 60);
      var s = rem % 60;
      var txt = (h > 0 ? h + ":" : "")
        + (h > 0 && m < 10 ? "0" : "") + m + ":"
        + (s < 10 ? "0" : "") + s;
      // 構造は examId が変わったときだけ作り直す（毎秒は文字だけ更新）
      if (timerEl._examId !== S.examId) {
        timerEl._examId = S.examId;
        timerEl.innerHTML =
          '<span class="t-text" title="模擬試験の画面に戻る"></span>'
          + '<button class="t-abandon" title="この模擬試験を中断して破棄">✕</button>';
        timerEl.querySelector(".t-text").addEventListener("click", function () {
          if (App.examSession)
            location.hash = "#exam-run/" + App.examSession.examId;
        });
        timerEl.querySelector(".t-abandon").addEventListener("click", function () {
          App.abandonExam();
        });
      }
      timerEl.querySelector(".t-text").textContent = "⏱ " + txt + " — " + S.name;
      timerEl.classList.remove("hidden", "warn", "danger");
      if (rem <= 300) timerEl.classList.add("danger");
      else if (rem <= 900) timerEl.classList.add("warn");
    },

    // 受験中の模擬試験を中断・破棄する（タイマーの ✕ ボタン用）
    abandonExam: function () {
      var S = App.examSession;
      if (!S) return;
      if (!global.confirm("受験中の模擬試験「" + S.name
        + "」を中断して破棄しますか？\n（解答内容は保存されません）"))
        return;
      App.examSession = null;
      App.stopTimer();
      App.saveExam();
      App.updateTimerDisplay();
      var route = location.hash.replace(/^#/, "").split("/")[0];
      if (route === "exam-run") location.hash = "#exam";
      else App.render();
    },

    // ---- VM ブリッジ接続状態 ----
    updateBridgeStatus: function () {
      if (!bridgeEl) return;
      var B = global.Bridge;
      bridgeEl.classList.remove("up", "down", "warn");
      if (!B || !B.bridgeUp) {
        bridgeEl.textContent = "● VM未接続";
        bridgeEl.classList.add("down");
        bridgeEl.title = "vmbridge.py が起動していません（自己採点は利用できます）";
      } else if (!B.connected) {
        bridgeEl.textContent = "● VM未到達";
        bridgeEl.classList.add("warn");
        bridgeEl.title = "ブリッジは起動中ですが VM に SSH 接続できません"
          + (B.info && B.info.error ? "（" + B.info.error + "）" : "");
      } else {
        bridgeEl.textContent = "● VM接続";
        bridgeEl.classList.add("up");
        bridgeEl.title = "VM に接続済み"
          + (B.info && B.info.hostname ? "（" + B.info.hostname + "）" : "");
      }
      // 接続状態が変わったら、表示中の問題画面のアクションバーも追従させる
      if (global.Screens && global.Screens.refreshActionBar)
        global.Screens.refreshActionBar();
    },

    pollBridge: function () {
      if (!global.Bridge) return;
      global.Bridge.checkStatus().then(function () {
        App.updateBridgeStatus();
      });
    },

    /* 模擬試験の提出。
       opts = { mode: "self" | "vm-batch", timeout: bool }
       - mode="vm-batch" のとき、autoGradeReady=true な問題は順次 VM 採点。
         採点不可な問題は selfGrade を採用し、未採点なら 0 点とする。
       - mode="self"（既定）は従来通り全問 selfGrade を採用。 */
    finalizeExam: function (opts) {
      opts = opts || {};
      var auto = !!opts.timeout;
      var mode = opts.mode || "self";
      var S = App.examSession;
      if (!S || S.submitted) return;

      // VM 一括採点：autoGradeReady な問題を順次 grade してから集計
      if (mode === "vm-batch" && global.Bridge && global.Bridge.connected) {
        App._vmBatchGrade(S, auto);
        return;
      }
      // それ以外（self / VM未接続）は従来通り即時集計
      App._completeExam(S, auto, mode);
    },

    _vmBatchGrade: function (S, auto) {
      var Q_MAP = (Screens && Screens._maps && Screens._maps.Q_MAP) || {};
      var tasks = S.tasks;
      var total = tasks.length;
      var i = 0;
      var gradedVm = 0, skippedSelf = 0, errors = 0;
      App._showGradingOverlay(0, total);

      function next() {
        if (i >= total) {
          App._hideGradingOverlay();
          App._completeExam(S, auto, "vm-batch", { gradedVm: gradedVm, skippedSelf: skippedSelf, errors: errors });
          return;
        }
        var t = tasks[i];
        var q = Q_MAP[t.qid];
        var label = q ? q.title : t.qid;
        App._updateGradingOverlay(i, total, label);
        if (!q || !q.autoGradeReady) {
          // 自動採点対象外 → selfGrade を採用してスキップ
          skippedSelf++;
          i++;
          setTimeout(next, 0);
          return;
        }
        global.Bridge.grade(t.qid, "live").then(function (br) {
          var sc = global.Grader.score(q, br);
          t.vmGrade = { earned: sc.earned, max: sc.max, perCheck: sc.perCheck };
          // VM 一括採点も進捗 (selfGrade) に反映する。手動評価は尊重する。
          Progress.recordAutoGradeAndSync(t.qid, sc, { ctx: "vm-batch" });
          gradedVm++;
        }).catch(function (e) {
          t.vmGradeError = (e && e.message) || String(e);
          errors++;
        }).then(function () {
          i++;
          App.saveExam();
          App._updateGradingOverlay(i, total, label);
          // 連続呼び出しで VM を詰まらせないよう小休止
          setTimeout(next, 80);
        });
      }
      next();
    },

    _completeExam: function (S, auto, mode, summary) {
      S.submitted = true;
      App.stopTimer();
      var results = S.tasks.map(function (t) {
        var earned = 0;
        var source = "self";
        if (t.vmGrade && typeof t.vmGrade.earned === "number"
          && t.vmGrade.max > 0) {
          // VM 採点：grader.checks 合計に対する得点比を配点にスケール
          earned = Math.round(t.vmGrade.earned / t.vmGrade.max * t.points);
          source = "vm-auto";
        } else if (t.vmGradeError) {
          // VM 採点失敗 → selfGrade に fallback
          source = "vm-error";
          if (t.selfGrade === "correct") earned = t.points;
          else if (t.selfGrade === "partial") earned = Math.round(t.points / 2);
        } else {
          // 自己採点
          if (t.selfGrade === "correct") earned = t.points;
          else if (t.selfGrade === "partial") earned = Math.round(t.points / 2);
        }
        return {
          qid: t.qid, points: t.points,
          selfGrade: t.selfGrade,
          vmGrade: t.vmGrade || null,
          vmGradeError: t.vmGradeError || null,
          source: source,
          earned: earned
        };
      });
      var score = results.reduce(function (a, r) { return a + r.earned; }, 0);
      var durationSec = Math.min(S.timeLimit,
        Math.max(0, Math.round((Date.now() - S.startedAt) / 1000)));
      var rec = {
        examId: S.examId, name: S.name,
        startedAt: new Date(S.startedAt).toISOString(),
        submittedAt: new Date().toISOString(),
        durationSec: durationSec,
        totalScore: S.totalScore, passScore: S.passScore,
        score: score, passed: score >= S.passScore,
        auto: !!auto,
        gradeMode: mode,        // "self" | "vm-batch"
        gradeSummary: summary || null,
        results: results
      };
      Progress.recordExam(rec);
      App.lastExamResult = rec;
      App.examSession = null;
      App.saveExam();
      App.updateTimerDisplay();
      if (auto) global.alert("制限時間に達したため自動で採点・提出しました。");
      if (location.hash === "#exam-result") App.render();
      else location.hash = "#exam-result";
    },

    // ---- VM 一括採点中のオーバーレイ ----
    _showGradingOverlay: function (done, total) {
      var ov = document.getElementById("grading-overlay");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "grading-overlay";
        ov.innerHTML =
          '<div class="grading-box">'
          + '<div class="grading-title">VM で一括採点中…</div>'
          + '<div class="grading-progress"><span></span></div>'
          + '<div class="grading-status"></div>'
          + '<div class="grading-note">この処理は数十秒〜数分かかります。'
          + '中断はできません（タブを閉じないでください）。</div>'
          + '</div>';
        document.body.appendChild(ov);
      }
      App._updateGradingOverlay(done, total, "");
    },
    _updateGradingOverlay: function (done, total, label) {
      var ov = document.getElementById("grading-overlay");
      if (!ov) return;
      var pct = total ? Math.round(done / total * 100) : 0;
      ov.querySelector(".grading-progress span").style.width = pct + "%";
      ov.querySelector(".grading-status").textContent =
        done + " / " + total + " 完了" + (label ? "（" + label + "）" : "");
    },
    _hideGradingOverlay: function () {
      var ov = document.getElementById("grading-overlay");
      if (ov) ov.parentNode.removeChild(ov);
    }
  };

  // 別の試験が受験中なら確認してから差し替える
  function examRunGuarded(examId) {
    var S = App.examSession;
    if (S && !S.submitted && S.examId !== examId) {
      var ok = global.confirm(
        "別の模擬試験「" + S.name + "」が受験中です。\n"
        + "破棄して新しい試験を始めますか？");
      if (!ok) {
        location.hash = "#exam-run/" + S.examId;
        return null;   // mount スキップ。hashchange で元の試験画面に戻る
      }
      App.examSession = null;
      App.stopTimer();
      App.saveExam();
    }
    return Screens.examRun(examId);
  }

  function setActiveNav(route) {
    var map = {
      home: "#home", exam: "#exam", "exam-run": "#exam", "exam-result": "#exam",
      drill: "#drill", random: "#drill", guides: "#guides", guide: "#guides",
      history: "#history"
    };
    var target = map[route] || "";
    document.querySelectorAll("#topnav a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === target);
    });
  }

  global.App = App;

  global.addEventListener("hashchange", App.render);

  // ---- キーボードショートカット ----------------------------
  // 問題画面で頻用するアクションをワンキーで実行する。
  // input/textarea/contenteditable 上では発火しない。
  // ?: ヘルプ表示 / N: 次 / P: 前 / G: VM 採点 / A: 答え合わせ
  // 1: ○ / 2: △ / 3: × / T: チャット開閉 / Esc: ヘルプ閉じる
  global.addEventListener("keydown", function (e) {
    var t = e.target;
    if (t && (t.matches && (t.matches("input,textarea,select,[contenteditable=true]")))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.shiftKey && e.key !== "?") return;

    var key = e.key;
    function click(sel) {
      var el = document.querySelector(sel);
      if (el && !el.disabled) { el.click(); return true; }
      return false;
    }
    switch (key) {
      case "?":
        e.preventDefault();
        toggleShortcutHelp();
        break;
      case "Escape":
        var help = document.getElementById("shortcut-help");
        if (help) { help.remove(); e.preventDefault(); }
        break;
      case "n": case "N":
        if (click('[data-nav=next]')) e.preventDefault();
        break;
      case "p": case "P":
        if (click('[data-nav=prev]')) e.preventDefault();
        break;
      case "g": case "G":
        if (click('[data-role=autograde]')) e.preventDefault();
        break;
      case "a": case "A":
        if (click('[data-role=check]')) e.preventDefault();
        break;
      case "1":
        if (click('.action-bar .sg-btn[data-g=correct]')) e.preventDefault();
        break;
      case "2":
        if (click('.action-bar .sg-btn[data-g=partial]')) e.preventDefault();
        break;
      case "3":
        if (click('.action-bar .sg-btn[data-g=wrong]')) e.preventDefault();
        break;
      case "t": case "T":
        var pane = document.querySelector('.chat-pane');
        if (pane && pane._toggleChat) { pane._toggleChat(); e.preventDefault(); }
        break;
    }
  });

  function toggleShortcutHelp() {
    var existing = document.getElementById("shortcut-help");
    if (existing) { existing.remove(); return; }
    var box = document.createElement("div");
    box.id = "shortcut-help";
    box.innerHTML =
      '<div class="sh-card">'
      + '<div class="sh-head">キーボードショートカット <span class="sh-close" title="閉じる (Esc)">✕</span></div>'
      + '<div class="sh-grid">'
      +   '<kbd>N</kbd><span>次の問題</span>'
      +   '<kbd>P</kbd><span>前の問題</span>'
      +   '<kbd>G</kbd><span>VM で採点</span>'
      +   '<kbd>A</kbd><span>答え合わせ（解説表示）</span>'
      +   '<kbd>1</kbd><span>○ できた</span>'
      +   '<kbd>2</kbd><span>△ あやしい</span>'
      +   '<kbd>3</kbd><span>× できない</span>'
      +   '<kbd>T</kbd><span>AI 家庭教師の開閉</span>'
      +   '<kbd>?</kbd><span>このヘルプ</span>'
      +   '<kbd>Esc</kbd><span>閉じる</span>'
      + '</div>'
      + '<div class="sh-foot">入力欄にフォーカスがあるときは無効</div>'
      + '</div>';
    document.body.appendChild(box);
    box.addEventListener("click", function (ev) {
      if (ev.target === box || ev.target.classList.contains("sh-close")) box.remove();
    });
  }

  function attachCopyButtons(root) {
    if (!root || !navigator.clipboard) return;
    root.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".code-copy-btn")) return;  // 二重注入防止
      pre.classList.add("code-with-copy");
      var btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.type = "button";
      btn.textContent = "コピー";
      btn.title = "クリップボードにコピー";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var code = pre.querySelector("code");
        var text = (code ? code.innerText : pre.innerText).replace(/^\s*コピー\s*$/m, "").trim();
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "コピー完了";
          btn.classList.add("copied");
          setTimeout(function () {
            btn.textContent = "コピー";
            btn.classList.remove("copied");
          }, 1500);
        }).catch(function () {
          btn.textContent = "失敗";
          setTimeout(function () { btn.textContent = "コピー"; }, 1500);
        });
      });
      pre.appendChild(btn);
    });
  }

  function init() {
    App.restoreExam();
    App.render();
    App.updateBridgeStatus();
    App.pollBridge();
    global.setInterval(App.pollBridge, 20000);
    var hint = document.getElementById("shortcut-hint-trigger");
    if (hint) hint.addEventListener("click", toggleShortcutHelp);
  }
  if (document.readyState === "loading")
    global.addEventListener("DOMContentLoaded", init);
  else
    init();
})(window);
