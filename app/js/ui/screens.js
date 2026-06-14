/* screens.js — 各画面の描画
   各 Screens.xxx() は { html: string, bind: function(rootEl){} } を返す。
   main.js のルーターが #app に流し込み bind を呼ぶ。 */
(function (global) {
  "use strict";

  // ---- データインデックス ----
  var Q_MAP = {};
  QUESTIONS.forEach(function (q) { Q_MAP[q.id] = q; });
  var CAT_MAP = {};
  CATEGORIES.forEach(function (c) { CAT_MAP[c.slug] = c; });
  var GUIDE_MAP = {};
  GUIDES.forEach(function (g) { GUIDE_MAP[g.slug] = g; });

  // ---- 問題画面モード (Learn / Practice) 永続化 ----
  // 試験 (#exam-run/...) は examRun 側で固定的に "exam" モードのため、ここでは扱わない。
  var QMODE_KEY = "rhcsa10_qmode_v1";
  function getQuestionMode() {
    try {
      var v = global.localStorage.getItem(QMODE_KEY);
      return v === "practice" ? "practice" : "learn";
    } catch (e) { return "learn"; }
  }
  function setQuestionMode(m) {
    try {
      global.localStorage.setItem(QMODE_KEY, m === "practice" ? "practice" : "learn");
    } catch (e) { /* */ }
  }

  // ---- 汎用ヘルパー ----
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function gradeSym(g) {
    return g === "correct" ? "○" : g === "partial" ? "△" : g === "wrong" ? "×" : "·";
  }
  function gradeClass(g) {
    return g === "correct" ? "g-correct" : g === "partial" ? "g-partial"
      : g === "wrong" ? "g-wrong" : "";
  }
  // 範囲スコープ：core(official) / extra(supplementary sample) / legacy(発展)
  function scopeBadge(q) {
    if (q.test === 7)
      return '<span class="badge scope-extra" title="補助の練習素材">extra</span>';
    return "";
  }
  function qualityBadge(q) {
    if (q.graderQuality === "A") {
      return '<span class="badge grader-a" title="高精度採点(Class A)：仕様に基づく厳密判定。'
        + 'VM 採点結果を合否判定の根拠として使えます。">'
        + '◆ 高精度採点 A</span>';
    }
    if (q.graderQuality === "B") {
      return '<span class="badge grader-b" title="補助採点(Class B)：最終状態のチェックが主。'
        + '手順や中間状態は検証しきれないので、模範解答との照合を推奨します。">'
        + '◇ 補助採点 B</span>';
    }
    return "";
  }
  function qHeader(q) {
    return '<div class="qhead">'
      + '<span class="qno">Test ' + q.test + " Q" + q.qno + "</span>"
      + '<span class="badge cat">' + esc(q.categoryLabel) + "</span>"
      + qualityBadge(q)
      + scopeBadge(q)
      + (q.legacy ? '<span class="badge legacy scope-legacy">発展(公式範囲外) '
        + esc(q.legacyReason || "") + "</span>" : "")
      + '<span class="badge diff">難易度 ' + q.difficulty + "/5</span>"
      + "</div>"
      + '<h2 style="border:none;margin:6px 0">' + esc(q.title) + "</h2>";
  }
  function labBoxHTML(q) {
    if (!q.lab || !q.lab.length) return "";
    return '<details class="labbox"><summary>環境</summary>'
      + '<ul class="lab-list">'
      + q.lab.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("")
      + "</ul></details>";
  }
  // STEP 2: 「対象サーバ」だけを常時表示し、lab 全文は details に格納する。
  // 個別 override (q.focusedLab) があれば最優先。なければ q.serverLabel/q.server
  // から自動生成し、disk・IP 等の詳細は折りたたみへ。
  function focusedLabHTML(q) {
    if (q.focusedLab) {
      return '<div class="lab-focused">' + q.focusedLab + "</div>";
    }
    var label = q.serverLabel
      || (q.server ? "Server" + q.server : "（指定なし）");
    var head = '<div class="lab-focused">対象: <strong>'
      + esc(label) + "</strong></div>";
    var details = (q.lab && q.lab.length)
      ? '<details class="labbox lab-detail"><summary>環境の詳細を表示</summary>'
        + '<ul class="lab-list">'
        + q.lab.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("")
        + "</ul></details>"
      : "";
    return head + details;
  }
  // 要件（spec）— 本試験形式の番号付き指定リスト。given（与えられる値）と
  // 条件を、課題文の直下に別枠で表示する（本試験の「following requirements」相当）。
  function specHTML(q) {
    var items = q.specHtml;
    if (!items || !items.length) return "";
    return '<ol class="spec-list">'
      + items.map(function (s) { return "<li>" + s + "</li>"; }).join("")
      + "</ol>";
  }
  // 落とし穴を「最重要 / よくあるミス / 別解」3 層で描画する。
  // データを変えず、配列の先頭 N 項目で機械的に分割する（後でデータ化したい
  // 問題は manual_overrides で構造化する余地を残す）。
  function renderPitfalls(items) {
    if (!items || !items.length) return "";
    var critical = items.slice(0, Math.min(2, items.length));
    var common = items.slice(2, 5);
    var alt = items.slice(5);
    function sec(label, list, cls) {
      if (!list.length) return "";
      return '<div class="pf-section pf-' + cls + '"><h4>' + label + "</h4><ul>"
        + list.map(function (h) { return "<li>" + h + "</li>"; }).join("")
        + "</ul></div>";
    }
    return '<div class="pitfalls pitfalls-stacked">'
      + '<h3>落とし穴・試験のポイント</h3>'
      + sec("最重要", critical, "critical")
      + sec("よくあるミス", common, "common")
      + sec("別解・補足", alt, "alt")
      + "</div>";
  }
  // コマンド早見表 (man 風ヘルプ) — その問題で使うコマンドの構文・主要オプション
  function cmdRefHTML(q) {
    if (typeof CMD_REF === "undefined") return "";
    var cmds = (q.commands || []).filter(function (c) { return CMD_REF[c]; });
    if (!cmds.length) return "";
    var items = cmds.map(function (name) {
      var r = CMD_REF[name];
      var opts = (r.options && r.options.length)
        ? '<div class="cr-opts">' + r.options.map(function (o) {
          return '<div class="cr-opt"><code>' + esc(o[0]) + "</code><span>"
            + esc(o[1]) + "</span></div>";
        }).join("") + "</div>"
        : "";
      var ex = (r.examples && r.examples.length)
        ? '<div class="cr-ex"><div class="cr-lbl">例</div>'
        + r.examples.map(function (e) { return "<pre>" + esc(e) + "</pre>"; }).join("")
        + "</div>"
        : "";
      var note = r.note ? '<div class="cr-note">' + esc(r.note) + "</div>" : "";
      return '<details class="cr-cmd"><summary>'
        + '<code class="cr-name">' + esc(name) + "</code>"
        + '<span class="cr-sum">' + esc(r.summary) + "</span></summary>"
        + '<div class="cr-body"><div class="cr-syntax"><code>'
        + esc(r.syntax) + "</code></div>" + opts + ex + note + "</div></details>";
    }).join("");
    return '<details class="cmdref"><summary>コマンド早見表'
      + " — この問題で使うコマンド " + cmds.length + " 個</summary>"
      + '<div class="cmdref-body">'
      + '<p class="cr-hint">本番試験でも <code>man</code> は参照できます。'
      + "構文と主要オプションの確認用です（解答そのものは表示されません）。</p>"
      + items + "</div></details>";
  }
  // 検証手順パネル — 実機(VM)で課題を実施したあと、自分で正しさを判定するための確認観点
  function verifyHTML(q) {
    var hasV = q.verifyHtml && q.verifyHtml.length;
    var hasR = q.rebootCheckHtml;
    if (!hasV && !hasR) return "";
    var vs = hasV
      ? '<ul class="vf-list">'
      + q.verifyHtml.map(function (v) { return "<li>" + v + "</li>"; }).join("")
      + "</ul>"
      : "";
    var rb = hasR
      ? '<div class="vf-reboot"><span class="vf-reboot-lbl">再起動後チェック</span>'
      + "<span>" + q.rebootCheckHtml + "</span></div>"
      : "";
    return '<details class="verifybox"><summary>検証手順'
      + " — 実機で実施したら、答えを見る前に自分で確認</summary>"
      + '<div class="verifybox-body">'
      + '<p class="vf-hint">VM で作業した結果が正しいか、下記の観点で自己検証しましょう。'
      + "RHCSA は設定が再起動後も維持されることが必須要件です。</p>"
      + vs + rb + "</div></details>";
  }
  function solutionBlock(q) {
    var gr = q.guideRef
      ? '<p class="src-note">関連する学習ガイド: <a href="#guide/'
        + esc(q.guideRef.slug) + '">' + esc(q.guideRef.title) + "</a></p>"
      : "";
    var pit = renderPitfalls(q.pitfallsHtml);
    return '<div class="solution"><h3>模範解答・解説（全手順）</h3>'
      + '<div class="md">' + q.solutionHtml + "</div>" + pit + gr + "</div>";
  }
  function selfGradeHTML(g) {
    return '<button class="sg-btn correct' + (g === "correct" ? " sel" : "")
      + '" data-g="correct">○ できた</button>'
      + '<button class="sg-btn partial' + (g === "partial" ? " sel" : "")
      + '" data-g="partial">△ あやしい</button>'
      + '<button class="sg-btn wrong' + (g === "wrong" ? " sel" : "")
      + '" data-g="wrong">× できない</button>';
  }
  function notFound(msg) {
    return {
      html: '<div class="empty">' + esc(msg || "ページが見つかりません")
        + '<br><br><a href="#home">ホームへ</a></div>', bind: null
    };
  }

  // 自動採点(VM ブリッジ)の check 別結果
  function autoGradeCheckRows(scored) {
    return scored.perCheck.map(function (c) {
      // 配点0のチェックは「環境前提の確認」。受験者の得点ではないので
      // 「0 / 0」と表示せず、前提OK/NG として区別する。
      if (!c.score) {
        return '<div class="ag-check precond ' + (c.passed ? "pass" : "fail") + '" '
          + 'title="環境前提の確認（配点なし）。NG の場合は操作ミスではなく VM 環境側の問題です">'
          + '<span class="ag-mark">' + (c.passed ? "○" : "×") + "</span>"
          + '<span class="ag-label">' + esc(c.label) + "</span>"
          + '<span class="ag-score">前提' + (c.passed ? "OK" : "NG") + '</span>'
          + "</div>";
      }
      return '<div class="ag-check ' + (c.passed ? "pass" : "fail") + '">'
        + '<span class="ag-mark">' + (c.passed ? "○" : "×") + "</span>"
        + '<span class="ag-label">' + esc(c.label) + "</span>"
        + '<span class="ag-score">' + c.earned + " / " + c.score + "</span>"
        + "</div>";
    }).join("");
  }
  function autoGradeResultHTML(q, scored) {
    var phaseLabel = scored.phase === "reboot" ? "再起動後チェック" : "現状態チェック";
    var hasReboot = typeof Grader !== "undefined" && Grader.hasRebootChecks(q);
    var classBwarn = q.graderQuality === "B"
      ? '<div class="ag-classb-warn">'
        + '<strong>◇ 補助採点(Class B) の注意</strong>'
        + '<p>この問題の採点チェックは「最終状態のみ」を見ています。'
        + '手順や中間状態の妥当性は検出できないため、'
        + '<strong>模範解答と照合して、自分の手順が正しいか確認してください</strong>。'
        + '合否判断は VM 採点結果だけに依存せず、解説と併せて行いましょう。</p>'
        + '</div>'
      : "";
    var html = '<div class="autograde-result' + (q.graderQuality === "B" ? " is-classb" : "") + '">'
      + "<h3>VM 実物採点 — " + phaseLabel + "</h3>"
      + classBwarn
      + autoGradeCheckRows(scored)
      + '<div class="ag-total">小計 ' + scored.earned + " / " + scored.max + " 点</div>";
    if (scored.phase === "live" && hasReboot) {
      html += '<div class="ag-reboot-note">この問題には再起動後の永続性チェックがあります。'
        + "VM を再起動してから下のボタンを押してください。</div>"
        + '<button data-role="rebootgrade">VM 再起動後チェックを実行</button>'
        + '<div data-role="rebootresult"></div>';
    }
    return html + "</div>";
  }

  // ---- 問題インタラクティブ部品 (ドリル/ランダム/復習/試験 共通) ----
  // mode: "drill"(既定) … 早見表・検証手順・答え合わせ・VMで採点あり
  //       "exam"        … 自己採点ボタンのみ（学習補助・解説は提出まで隠す）
  // drill 配下では qmode（"learn"/"practice"）でさらに表示を絞る。
  function questionInteractiveHTML(q, state, mode) {
    state = state || {};
    var isExam = (mode || "drill") === "exam";
    var qmode = isExam ? "exam" : getQuestionMode();
    var isPractice = qmode === "practice";
    var connected = !!(global.Bridge && global.Bridge.connected);
    var hasVM = !!q.autoGradeReady && !isExam;
    var vmPrimary = hasVM && connected;

    var qcardCls = "qcard";
    if (isPractice) qcardCls += " mode-practice";

    var html = '<div class="' + qcardCls + '">' + qHeader(q);

    // モードトグル（drill 配下のみ）
    if (!isExam) {
      html += '<div class="mode-toggle" data-role="mode-toggle">'
        + '<button data-mode="learn"' + (qmode === "learn" ? ' class="active"' : "")
        + ' title="早見表・検証・解答を見ながら理解する">学ぶ</button>'
        + '<button data-mode="practice"' + (isPractice ? ' class="active"' : "")
        + ' title="ヒントなしで手を動かす（降参で解答）">解く</button>'
        + "</div>";
      html += '<div class="mode-hint">'
        + (isPractice
          ? '自力で挑戦中。「ヘルプを開く」で早見表・検証、「降参して解答」で全公開。'
          : '早見表・検証・解答を表示中（初回理解向け）。')
        + "</div>";
    }

    // STEP 1 — 課題（exam では見出しを出さず問題文に集中）
    if (!isExam) html += '<div class="step-label">課題</div>';
    html += '<div class="prompt">' + (q.promptHtml || esc(q.prompt)) + "</div>";
    // STEP 1.5 — 要件（本試験形式の指定リスト。given・条件を別枠で）
    if (q.specHtml && q.specHtml.length) {
      if (!isExam) html += '<div class="step-label">要件</div>';
      html += specHTML(q);
    }
    // STEP 2 — 対象（focusedLab：常時は server だけ、詳細は折りたたみ）
    if (!isExam) html += '<div class="step-label">対象</div>';
    html += focusedLabHTML(q);
    if (!isExam) {
      html += '<div class="step-label">実機で採点・確認'
        + '<span class="step-hint">早見表・検証手順・答え合わせはここから</span>'
        + "</div>";
      // Practice モードでも HTML には埋めておく（CSS で非表示。「ヘルプを開く」で出る）
      html += cmdRefHTML(q) + verifyHTML(q);
    }
    html += '<div class="action-bar">';
    if (!isExam) {
      if (hasVM)
        html += '<button data-role="autograde"' + (vmPrimary ? ' class="primary"' : "")
          + ">VMで採点</button>";
      if (isPractice) {
        html += '<button data-role="showhelp" title="早見表と検証だけ開く">'
          + 'ヘルプを開く</button>'
          + '<button data-role="surrender" title="降参して模範解答を見る">'
          + '降参して解答を見る</button>';
      } else {
        html += '<button data-role="check"' + (!vmPrimary ? ' class="primary"' : "")
          + ">答え合わせ</button>";
      }
      html += '<span class="ab-sep"></span>';
    }
    html += '<span class="sg-group">' + selfGradeHTML(state.selfGrade) + "</span>";
    if (!isExam)
      html += '<span class="ab-spacer"></span><button data-role="reset">リセット</button>';
    html += '</div><div data-role="agwrap"></div>';
    if (!isExam) html += '<div data-role="solwrap"></div>';
    if (!isExam) html += '<div data-role="nextwrap"></div>';
    return html + "</div>";
  }

  // 採点後に出す「次のアクション」パネル
  function nextActionsHTML(q, opts) {
    opts = opts || {};
    var sess = global.App && global.App.session;
    // 同カテゴリの弱点（× / △）
    var weak = Progress.weakInCategory(q.category, QUESTIONS, q.id);
    // 未着手（公式範囲）— セッション中なら次の問題を優先
    var sessNext = "";
    if (sess && sess.list) {
      var i = sess.list.indexOf(q.id);
      if (i >= 0 && i < sess.list.length - 1) sessNext = sess.list[i + 1];
    }
    var untried = Progress.untouchedList(QUESTIONS).filter(function (id) {
      return id !== q.id;
    });
    var nextUntried = sessNext || untried[0] || null;
    var nextWeak = weak[0] || null;

    var btns = [];
    if (nextUntried) {
      btns.push('<button class="na-btn na-next primary" data-target="#q/'
        + esc(nextUntried) + '">▶ '
        + (sessNext ? "次の問題へ" : "次の未着手へ") + '</button>');
    }
    if (nextWeak) {
      btns.push('<button class="na-btn na-weak" data-target="#q/' + esc(nextWeak) + '">'
        + '同カテゴリの弱点へ <span class="na-sub">（'
        + esc(CAT_MAP[q.category] ? CAT_MAP[q.category].label : q.category)
        + " · 残 " + weak.length + " 問）</span></button>");
    }
    if (!opts.revealed) {
      btns.push('<button class="na-btn na-sol" data-target="reveal">'
        + '解説を読む</button>');
    }
    btns.push('<button class="na-btn na-back" data-target="back">'
      + '一覧へ戻る</button>');
    return '<div class="next-actions">'
      + '<h3>次のアクション</h3>'
      + '<div class="na-grid">' + btns.join("") + '</div>'
      + '</div>';
  }

  function bindQuestionInteractive(root, q, opts) {
    opts = opts || {};
    var state = opts.state || {};
    var isExam = (opts.mode || "drill") === "exam";
    var qcardEl = root.querySelector(".qcard");
    var solwrap = root.querySelector("[data-role=solwrap]");
    var agwrap = root.querySelector("[data-role=agwrap]");
    var checkBtn = root.querySelector("[data-role=check]");
    var resetBtn = root.querySelector("[data-role=reset]");
    var agBtn = root.querySelector("[data-role=autograde]");
    var helpBtn = root.querySelector("[data-role=showhelp]");
    var surBtn = root.querySelector("[data-role=surrender]");
    var modeToggle = root.querySelector("[data-role=mode-toggle]");
    var sgBtns = root.querySelectorAll(".action-bar .sg-btn");
    var nextwrap = root.querySelector("[data-role=nextwrap]");

    function showNextActions() {
      if (!nextwrap || isExam) return;
      nextwrap.innerHTML = nextActionsHTML(q, { revealed: !!state.revealed });
      nextwrap.querySelectorAll(".na-btn").forEach(function (b) {
        b.onclick = function () {
          var t = b.getAttribute("data-target");
          if (t === "reveal") {
            if (checkBtn) checkBtn.click();
            else if (surBtn) surBtn.click();
          } else if (t === "back") {
            var crumbBack = root.querySelector(".crumbs a");
            if (crumbBack) location.hash = crumbBack.getAttribute("href");
            else location.hash = "#home";
          } else {
            location.hash = t;
          }
        };
      });
    }

    function renderAutoGrade(scored) {
      agwrap.innerHTML = autoGradeResultHTML(q, scored);
      var rb = agwrap.querySelector("[data-role=rebootgrade]");
      if (rb) rb.onclick = function () {
        rb.disabled = true; rb.textContent = "採点中…";
        global.Bridge.grade(q.id, "reboot").then(function (res) {
          var s2 = Grader.score(q, res);
          var rr = agwrap.querySelector("[data-role=rebootresult]");
          if (rr) rr.innerHTML = autoGradeCheckRows(s2)
            + '<div class="ag-total">再起動後 小計 ' + s2.earned
            + " / " + s2.max + " 点</div>";
          if (opts.onAutoGrade) opts.onAutoGrade(s2);
        }).catch(function (e) {
          rb.disabled = false; rb.textContent = "VM 再起動後チェックを実行";
          var rr = agwrap.querySelector("[data-role=rebootresult]");
          if (rr) rr.innerHTML = '<div class="ag-msg ag-err">採点エラー: '
            + esc(e.message) + "</div>";
        });
      };
    }
    if (agBtn) agBtn.onclick = function () {
      if (!global.Bridge || !global.Bridge.connected) {
        agwrap.innerHTML = '<div class="ag-msg ag-err">VM ブリッジが未接続です。'
          + "tools/vmbridge.py を起動して VM に接続してください"
          + "（詳細は SETUP-vmbridge.md）。</div>";
        return;
      }
      agBtn.disabled = true; agBtn.textContent = "採点中…";
      agwrap.innerHTML = '<div class="ag-msg">VM で採点中…</div>';
      global.Bridge.grade(q.id, "live").then(function (res) {
        var scored = Grader.score(q, res);
        renderAutoGrade(scored);
        if (opts.onAutoGrade) opts.onAutoGrade(scored);
        showNextActions();
        agwrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }).catch(function (e) {
        agwrap.innerHTML = '<div class="ag-msg ag-err">採点エラー: '
          + esc(e.message) + "</div>";
      }).then(function () {
        agBtn.disabled = false; agBtn.textContent = "VMで採点";
      });
    };

    function showSolution() {
      if (solwrap) solwrap.innerHTML = solutionBlock(q);
    }
    // 自己採点ボタンは drill/exam 両方で常時表示・常時バインド
    sgBtns.forEach(function (b) {
      b.onclick = function () {
        var g = b.getAttribute("data-g");
        state.selfGrade = g;
        sgBtns.forEach(function (x) { x.classList.remove("sel"); });
        b.classList.add("sel");
        if (opts.onGrade) opts.onGrade(g);
        showNextActions();
      };
    });
    if (checkBtn) checkBtn.onclick = function () {
      state.revealed = true;
      if (opts.onReveal) opts.onReveal();
      showSolution();
      showNextActions();
      if (solwrap) solwrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    if (resetBtn) resetBtn.onclick = function () {
      state.revealed = false;
      state.selfGrade = null;
      if (solwrap) solwrap.innerHTML = "";
      if (agwrap) agwrap.innerHTML = "";
      if (nextwrap) nextwrap.innerHTML = "";
      sgBtns.forEach(function (x) { x.classList.remove("sel"); });
      if (qcardEl) qcardEl.classList.remove("helped");
      if (opts.onReset) opts.onReset();
    };
    // モード切替（学ぶ ⇄ 解く）— localStorage 永続化 + 全体再描画
    if (modeToggle) {
      modeToggle.querySelectorAll("button").forEach(function (b) {
        b.onclick = function () {
          var newMode = b.getAttribute("data-mode");
          if (newMode === getQuestionMode()) return;
          setQuestionMode(newMode);
          global.App.render();
        };
      });
    }
    // 解くモード: ヘルプを開く（早見表・検証だけ表示）
    if (helpBtn) helpBtn.onclick = function () {
      if (qcardEl) qcardEl.classList.add("helped");
      helpBtn.disabled = true;
      helpBtn.textContent = "ヘルプ表示中";
    };
    // 解くモード: 降参して解答を見る
    if (surBtn) surBtn.onclick = function () {
      if (!global.confirm("降参して模範解答を表示しますか？")) return;
      if (qcardEl) {
        qcardEl.classList.remove("mode-practice");
        qcardEl.classList.add("helped");
      }
      state.revealed = true;
      if (opts.onReveal) opts.onReveal();
      showSolution();
      if (solwrap) solwrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    // exam mode では旧 sessionStorage の revealed:true があっても解説を出さない
    if (!isExam && state.revealed) { showSolution(); showNextActions(); }
  }

  // =========================================================================
  // 「今日やる」3カード（ホーム / 復習 で共通利用）
  // =========================================================================
  function todayCardHTML(key, title, count, desc) {
    var off = count === 0;
    return '<div class="card today-card' + (off ? " disabled" : "") + '"'
      + (off ? "" : ' data-review="' + key + '"') + ">"
      + "<h3>" + esc(title) + "</h3>"
      + '<div class="big" style="font-size:22px;margin-top:4px">'
      + (off ? "対象なし" : count + " 問") + "</div>"
      + '<div class="meta">' + esc(desc) + "</div></div>";
  }
  function renderTodayCards() {
    var wrong = Progress.wrongList();
    var partial = Progress.partialList();
    var untouched = Progress.untouchedList(QUESTIONS);
    var html = '<div class="grid home-today">'
      + todayCardHTML("wrong", "× できない問題", wrong.length, "× を付けた問題を順に再挑戦")
      + todayCardHTML("partial", "△ あやしい問題", partial.length, "△ を付けた問題を順に再挑戦")
      + todayCardHTML("untouched", "・ 未着手の問題", untouched.length,
        "まだ解いていない問題から（legacy 除く）")
      + "</div>";
    return { html: html, wrong: wrong, partial: partial, untouched: untouched };
  }
  function bindTodayCards(root, lists) {
    function startReview(list, label) {
      if (!list.length) return;
      global.App.session = {
        mode: "review", label: label,
        baseHash: location.hash || "#home",
        list: list.slice()
      };
      location.hash = "#q/" + list[0];
    }
    root.querySelectorAll(".today-card[data-review]").forEach(function (card) {
      card.onclick = function () {
        var k = card.getAttribute("data-review");
        if (k === "wrong") startReview(lists.wrong, "復習（できない問題）");
        else if (k === "partial") startReview(lists.partial, "復習（あやしい問題）");
        else startReview(lists.untouched, "復習（未着手の問題）");
      };
    });
  }

  function dashBox(num, lbl, sub, opts) {
    opts = opts || {};
    var cls = "dash-num" + (opts.dim ? " dim" : "");
    return '<div class="dash-box"><div class="' + cls + '">'
      + esc(num) + '</div><div class="dash-lbl">' + esc(lbl)
      + '</div><div class="dash-sub">' + esc(sub) + '</div></div>';
  }

  // ランク → 表示メタ情報
  var RANK_META = {
    "exam-ready": { label: "EXAM READY", short: "★ Exam Ready" },
    "gold":       { label: "GOLD",        short: "★ Gold" },
    "silver":     { label: "SILVER",      short: "★ Silver" },
    "bronze":     { label: "BRONZE",      short: "★ Bronze" },
    "none":       { label: "—",           short: "未達" }
  };
  function rankBadgeHTML(rank) {
    var m = RANK_META[rank] || RANK_META.none;
    return '<span class="rank-badge rank-' + rank + '">' + esc(m.short) + '</span>';
  }

  // 公式10カテゴリの coverage 表（legacy 除外で正答率を計算 + ランク表示）
  function renderCategoryCoverage() {
    var cstat = Progress.categoryStats(QUESTIONS);
    var ranks = Progress.categoryRanks(QUESTIONS);
    var officialByCat = {};
    CATEGORIES.forEach(function (c) {
      officialByCat[c.slug] = QUESTIONS.filter(function (q) {
        return q.category === c.slug && !q.legacy;
      }).length;
    });
    var rows = CATEGORIES.map(function (c) {
      var s = cstat[c.slug] || { attempted: 0, correct: 0, partial: 0, wrong: 0, total: 0 };
      var off = officialByCat[c.slug] || 0;
      var pct = off ? Math.round((s.correct + s.partial * 0.5) / off * 100) : 0;
      var rank = ranks[c.slug] ? ranks[c.slug].rank : "none";
      return '<div class="cat-stat rank-row-' + rank + '"><span>'
        + '<a href="#drill/' + esc(c.slug) + '">' + esc(c.label) + '</a>'
        + " " + rankBadgeHTML(rank)
        + '</span>'
        + '<div class="bar"><span style="width:' + pct + '%"></span></div>'
        + '<span class="cs-detail">' + s.attempted + "/" + off
        + " (" + pct + "%)</span></div>";
    }).join("");
    return '<div class="dash-cover">' + rows + "</div>";
  }

  // =========================================================================
  // ホーム — 学習ダッシュボード
  // =========================================================================
  function home() {
    var st = Progress.stats(QUESTIONS);
    var off = Progress.officialSummary(QUESTIONS);
    var vmReadyCount = QUESTIONS.filter(function (q) { return q.autoGradeReady; }).length;
    var vmDone = Progress.vmGradedCount();
    var hp = Progress.highPrecisionCompleted(QUESTIONS);
    var examBest = Progress.examBest();
    var todayN = Progress.todayCompleted();
    var streakN = Progress.streak();
    var today = renderTodayCards();

    var bestNum = examBest.overall
      ? examBest.overall.score + " / " + examBest.overall.totalScore
      : "—";
    var bestSub = examBest.overall
      ? esc(examBest.overall.name) + " · 受験 " + examBest.count + " 回"
      : "未受験 — 模擬試験で実力チェック";

    // 今日の達成バナー（3問以上で達成、5問以上で大達成）
    var todayBanner = "";
    if (todayN >= 5) {
      todayBanner = '<div class="today-banner today-great">'
        + '<span class="tb-icon">★★★</span>'
        + '<span class="tb-text">今日は <strong>' + todayN + ' 問</strong> 完了！'
        + 'この調子です。streak <strong>' + streakN + ' 日</strong> 継続中。</span>'
        + '</div>';
    } else if (todayN >= 3) {
      todayBanner = '<div class="today-banner today-done">'
        + '<span class="tb-icon">★★</span>'
        + '<span class="tb-text">今日のノルマ (3 問) 達成！ '
        + '現在 <strong>' + todayN + ' 問</strong>。streak <strong>'
        + streakN + ' 日</strong> 継続中。</span>'
        + '</div>';
    } else if (todayN > 0) {
      todayBanner = '<div class="today-banner today-progress">'
        + '<span class="tb-icon">▶</span>'
        + '<span class="tb-text">今日 <strong>' + todayN + ' 問</strong> 完了。'
        + 'あと <strong>' + (3 - todayN) + ' 問</strong> で本日のノルマ達成。</span>'
        + '</div>';
    }

    var html = "<h1>RHCSA10 exam practice</h1>"
      + '<p class="subtitle">RHEL 10 EX200 practice — engine demo on an original sample task set. The full question bank is excluded for copyright.</p>'
      + todayBanner
      + '<div class="dash-row">'
      + dashBox(off.score + "%", "合格準備スコア",
          "サンプル " + off.attempted + "/" + off.total + " 着手 / "
          + "○" + off.correct + " △" + off.partial)
      + dashBox(hp.done + " / " + hp.total, "高精度採点で完了",
          hp.total
            ? "Class A を VM で実機採点 — 合否判定の根拠 / "
              + "VM 全体: " + vmDone + "/" + vmReadyCount
            : "Class A 問題なし",
          { dim: hp.total === 0 })
      + dashBox(streakN + " 日", "連続学習 streak",
          streakN >= 7 ? "1 週間以上継続中！習慣化できています"
          : streakN >= 3 ? "3 日以上継続中。あと少しで習慣化"
          : streakN > 0 ? "毎日少しずつ続けましょう"
          : "今日 1 問解いて streak を開始",
          { dim: streakN === 0 })
      + dashBox(bestNum, "模擬試験 最高点", bestSub,
          { dim: !examBest.overall })
      + dashBox(st.wrong, "× できない問題",
          "復習画面から優先で再挑戦",
          { dim: st.wrong === 0 })
      + "</div>"
      + '<h2 style="margin-top:24px">今日やる</h2>'
      + today.html
      + '<h2>カテゴリ別カバレッジ</h2>'
      + '<p class="subtitle" style="margin:0 0 8px">'
      + '各カテゴリの自己採点正答率です。'
      + 'カテゴリ名をクリックでドリルへ。</p>'
      + renderCategoryCoverage()
      + '<h2>学習メニュー</h2>'
      + '<div class="home-actions">'
      + actionCard("#drill", "▶ 分野別ドリル", "カテゴリ別", "カテゴリを選んで集中特訓。全分野・間違いからのランダムも。")
      + actionCard("#history", "▶ 復習", "弱点から再挑戦", "できない・あやしい・未着手の問題を today から。")
      + actionCard("#guides", "▶ 学習ガイド", "ガイド", "分野別チートシート。コマンドリファレンスと頻出パターン。")
      + actionCard("#exam", "▶ 模擬試験", "サンプル模試（デモ）", "オリジナル問題で通し受験＋自己採点。")
      + "</div>";
    return {
      html: html,
      bind: function (root) {
        bindTodayCards(root, today);
      }
    };
  }
  function statBox(num, lbl) {
    return '<div class="stat-box"><div class="num">' + esc(num)
      + '</div><div class="lbl">' + esc(lbl) + "</div></div>";
  }
  function actionCard(hash, title, sub, desc) {
    return '<div class="card" data-hash="' + esc(hash) + '">'
      + "<h3>" + esc(title) + '</h3><div class="ico">' + esc(sub) + "</div>"
      + '<div class="meta" style="margin-top:6px">' + esc(desc) + "</div></div>";
  }

  // =========================================================================
  // 模擬試験一覧
  // =========================================================================
  function examList() {
    var exams = Progress.getExams();
    function bestFor(id) {
      var best = null;
      exams.forEach(function (e) {
        if (e.examId === id && (best === null || e.score > best)) best = e.score;
      });
      return best;
    }
    var cards = EXAMS.map(function (e) {
      var best = bestFor(e.id);
      var active = global.App.examSession && global.App.examSession.examId === e.id
        && !global.App.examSession.submitted;
      var isBoss = e.boss === true;
      var cardCls = "card exam-card" + (isBoss ? " exam-boss" : "");
      var bossTag = isBoss
        ? '<span class="badge exam-boss-badge" title="本番直前の力試し用">★ BOSS</span>'
        : "";
      return '<div class="' + cardCls + '" data-hash="#exam-run/' + esc(e.id) + '">'
        + "<h3>" + esc(e.name) + " " + bossTag
        + (active ? " <span class='badge'>受験中</span>" : "")
        + "</h3>"
        + '<div class="meta">' + e.tasks.length + " タスク / "
        + e.totalScore + "点満点 / 合格 " + e.passScore + "点</div>"
        + '<div class="meta">制限時間 ' + Math.round(e.timeLimit / 60) + " 分</div>"
        + '<div class="big" style="font-size:16px;margin-top:8px">'
        + (best != null ? "最高 " + best + "点" : "未受験") + "</div>"
        + "</div>";
    }).join("");
    var html = "<h1>模擬試験</h1>"
      + '<div class="exam-mode-banner">'
      + '<span class="emb-icon">●</span>'
      + '<span class="emb-text"><strong>本番モード</strong>: 開始後は制限時間のカウントダウン中に '
      + 'タスクを順に解いてください。途中で他画面に移動しても採点中の試験は継続します。</span>'
      + '</div>'
      + '<p class="subtitle">A timed sample exam built from original tasks (demo). '
      + "Start it to run the countdown and self-assess. "
      + "The real exam sets belong to the excluded private dataset.</p>"
      + '<div class="grid">' + cards + "</div>";
    return { html: html, bind: null };
  }

  // =========================================================================
  // 模擬試験ランタイム
  // =========================================================================
  function examRun(examId) {
    var exam = null;
    EXAMS.forEach(function (e) { if (e.id === examId) exam = e; });
    if (!exam) return notFound("模擬試験が見つかりません: " + examId);

    var App = global.App;
    if (!App.examSession || App.examSession.examId !== examId
      || App.examSession.submitted) {
      App.startExam(exam);
    }
    var S = App.examSession;
    var idx = Math.min(S.index, S.tasks.length - 1);
    S.index = idx;
    var task = S.tasks[idx];
    var q = Q_MAP[task.qid];
    // データ再生成で qid が消えた受験中セッション等の防御（描画クラッシュ回避）
    if (!q) return notFound("この模擬試験のタスク「" + task.qid
      + "」が問題データに見つかりません（データ再生成の可能性）。"
      + "タイマー横の ✕ で中断してやり直してください。");

    var side = S.tasks.map(function (t, i) {
      var mark = t.selfGrade
        ? '<span class="' + gradeClass(t.selfGrade) + '">'
          + gradeSym(t.selfGrade) + "</span>"
        : '<span style="color:var(--fg-dim)">·</span>';
      return '<div class="titem' + (i === idx ? " active" : "") + '" data-ti="'
        + i + '"><span class="tno">' + (i + 1) + "</span>"
        + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;'
        + 'white-space:nowrap">' + esc((Q_MAP[t.qid] || {}).title || t.qid) + "</span>"
        + '<span class="tst">' + mark + "</span></div>";
    }).join("");

    var vmConn = !!(global.Bridge && global.Bridge.connected);
    var autoCount = S.tasks.filter(function (t) {
      var qq = Q_MAP[t.qid];
      return qq && qq.autoGradeReady;
    }).length;
    var submitButtons =
      '<div style="padding:8px;display:flex;flex-direction:column;gap:6px">'
      + (vmConn
        ? '<button data-role="vmsubmit" class="primary" style="width:100%">'
        + 'VM で一括採点して提出</button>'
        + '<div style="font-size:11px;color:var(--fg-dim);text-align:center">'
        + 'うち VM 自動採点対象: ' + autoCount + ' / ' + S.tasks.length + ' 問'
        + '<br>残りは○△× 自己採点を採用</div>'
        : '<div style="font-size:11px;color:var(--fg-dim);text-align:center">'
        + '● VM 未接続 — VM 一括採点は無効<br>'
        + 'vmbridge.py を起動すると有効化されます</div>')
      + '<button data-role="submit" class="danger" style="width:100%">'
      + (vmConn ? '自己採点だけで提出' : '採点して提出')
      + '</button></div>';
    var html = '<div class="pagehead"><h1>' + esc(exam.name) + "</h1>"
      + '<span class="badge">タスク ' + (idx + 1) + " / " + S.tasks.length + "</span>"
      + '<span class="badge">配点 ' + task.points + " 点</span></div>"
      + '<div class="exam-layout">'
      + '<div class="task-sidebar">' + side + submitButtons + "</div>"
      + "<div>" + questionInteractiveHTML(q, task, "exam")
      + '<div class="navrow">'
      + (idx > 0 ? '<button data-role="prev">← 前のタスク</button>' : "")
      + '<span class="spacer"></span>'
      + (idx < S.tasks.length - 1
        ? '<button data-role="next" class="primary">次のタスク →</button>'
        : (vmConn
          ? '<button data-role="vmsubmit2" class="primary">VM で一括採点して提出</button>'
          : '<button data-role="submit2" class="danger">採点して提出</button>'))
      + "</div></div></div>";

    return {
      html: html, bind: function (root) {
        bindQuestionInteractive(root, q, {
          state: task,
          mode: "exam",
          onGrade: function (g) {
            task.selfGrade = g;
            Progress.recordQuestion(q.id, g, "exam:" + examId);
            App.saveExam();
            markSidebar(root, idx, task);
          }
        });
        root.querySelectorAll(".titem").forEach(function (it) {
          it.onclick = function () {
            S.index = parseInt(it.getAttribute("data-ti"), 10);
            App.saveExam(); App.render();
          };
        });
        var prev = root.querySelector("[data-role=prev]");
        if (prev) prev.onclick = function () { S.index--; App.saveExam(); App.render(); };
        var next = root.querySelector("[data-role=next]");
        if (next) next.onclick = function () { S.index++; App.saveExam(); App.render(); };
        function selfSubmit() {
          if (global.confirm("自己採点（○△×）の結果で提出しますか？\n"
              + "（この操作は取り消せません）"))
            App.finalizeExam({ mode: "self" });
        }
        function vmSubmit() {
          var msg = "VM で全タスクを一括採点して提出します。\n\n"
            + "・autoGradeReady な問題は VM に SSH して check コマンドで判定\n"
            + "・対象外の問題は ○△× 自己採点を採用\n"
            + "・採点中はタブを閉じないでください\n"
            + "・所要時間: 数十秒〜数分\n\n進めますか？";
          if (global.confirm(msg))
            App.finalizeExam({ mode: "vm-batch" });
        }
        var sb = root.querySelector("[data-role=submit]");
        if (sb) sb.onclick = selfSubmit;
        var sb2 = root.querySelector("[data-role=submit2]");
        if (sb2) sb2.onclick = selfSubmit;
        var vsb = root.querySelector("[data-role=vmsubmit]");
        if (vsb) vsb.onclick = vmSubmit;
        var vsb2 = root.querySelector("[data-role=vmsubmit2]");
        if (vsb2) vsb2.onclick = vmSubmit;
      }
    };
  }
  function markSidebar(root, idx, task) {
    var it = root.querySelector('.titem[data-ti="' + idx + '"] .tst');
    if (!it) return;
    if (task.selfGrade)
      it.innerHTML = '<span class="' + gradeClass(task.selfGrade) + '">'
        + gradeSym(task.selfGrade) + "</span>";
    else it.innerHTML = '<span style="color:var(--fg-dim)">·</span>';
  }

  // =========================================================================
  // 模擬試験 結果
  // =========================================================================
  function examResult() {
    var r = global.App.lastExamResult;
    if (!r) {
      var exams = Progress.getExams();
      if (!exams.length) return notFound("受験記録がありません");
      r = exams[exams.length - 1];
    }
    function sourceCell(t) {
      // VM 採点：満点 / 部分 / ゼロ で大きなマークを出す
      if (t.source === "vm-auto" && t.vmGrade && t.vmGrade.max > 0) {
        var ratio = t.vmGrade.earned / t.vmGrade.max;
        var cls, mark;
        if (ratio >= 1) { cls = "perfect"; mark = "○"; }   // 満点 → 赤い○
        else if (ratio > 0) { cls = "partial"; mark = "△"; }
        else { cls = "zero"; mark = "×"; }
        return '<div class="judgement ' + cls + '" title="VM SSH 採点">'
          + '<div class="big-mark">' + mark + '</div>'
          + '<div class="src-tag">VM ' + t.vmGrade.earned + '/' + t.vmGrade.max + '</div>'
          + '</div>';
      }
      // VM 採点失敗 → 自己採点 fallback
      if (t.source === "vm-error") {
        var cls2 = t.selfGrade === "correct" ? "perfect"
          : t.selfGrade === "partial" ? "partial"
          : t.selfGrade === "wrong" ? "zero" : "none";
        return '<div class="judgement ' + cls2 + '" title="VM 採点失敗 → 自己採点で代用">'
          + '<div class="big-mark">' + gradeSym(t.selfGrade) + '</div>'
          + '<div class="src-tag warn">⚠ VM失敗</div>'
          + '</div>';
      }
      // 自己採点
      var cls3 = t.selfGrade === "correct" ? "perfect"
        : t.selfGrade === "partial" ? "partial"
        : t.selfGrade === "wrong" ? "zero" : "none";
      return '<div class="judgement ' + cls3 + '" title="自己採点">'
        + '<div class="big-mark">' + gradeSym(t.selfGrade) + '</div>'
        + '<div class="src-tag">自己</div>'
        + '</div>';
    }
    var rows = r.results.map(function (t, i) {
      var q = Q_MAP[t.qid];
      return "<tr><td>" + (i + 1) + "</td>"
        + "<td>" + esc(q ? q.categoryLabel : "") + "</td>"
        + "<td>" + esc(q ? q.title : t.qid) + "</td>"
        + '<td style="text-align:center">' + sourceCell(t) + "</td>"
        + '<td style="text-align:right">' + t.earned + " / " + t.points + "</td></tr>";
    }).join("");
    // カテゴリ別
    var catAgg = {};
    r.results.forEach(function (t) {
      var q = Q_MAP[t.qid]; if (!q) return;
      if (!catAgg[q.category]) catAgg[q.category] = { e: 0, p: 0 };
      catAgg[q.category].e += t.earned;
      catAgg[q.category].p += t.points;
    });
    var catRows = Object.keys(catAgg).map(function (slug) {
      var a = catAgg[slug];
      var pct = a.p ? Math.round(a.e / a.p * 100) : 0;
      return '<div class="cat-stat"><span>' + esc(CAT_MAP[slug] ? CAT_MAP[slug].label : slug) + "</span>"
        + '<div class="bar"><span style="width:' + pct + '%"></span></div>'
        + "<span>" + a.e + "/" + a.p + "</span></div>";
    }).join("");
    var passed = r.passed;
    var modeLabel = "";
    if (r.gradeMode === "vm-batch") {
      var s = r.gradeSummary || {};
      modeLabel = ' <span class="badge badge-vm">VM 一括採点</span>'
        + ' <span style="font-size:12px;color:var(--fg-dim)">'
        + 'VM自動 ' + (s.gradedVm || 0) + ' 問 / 自己代替 ' + (s.skippedSelf || 0) + ' 問'
        + (s.errors ? ' / VM失敗 ' + s.errors + ' 問' : '')
        + '</span>';
    } else if (r.gradeMode === "self") {
      modeLabel = ' <span class="badge">自己採点</span>';
    }
    // 弱点 = 満点を取れなかった問題（未採点 / あやしい / できない / VM 部分点 / VM ゼロ）
    var weakIds = r.results
      .filter(function (t) { return t.earned < t.points; })
      .map(function (t) { return t.qid; });
    var reviewBtn = weakIds.length
      ? '<button class="primary" data-role="review-weak">'
        + '↺ この試験の弱点 ' + weakIds.length + ' 問を復習する</button>'
      : '';

    var html = "<h1>" + esc(r.name) + " — 採点結果" + modeLabel + "</h1>"
      + '<div class="verdict ' + (passed ? "pass" : "fail") + '">'
      + (passed ? "合格" : "不合格") + " &nbsp; " + r.score + " / " + r.totalScore
      + " 点 &nbsp;(合格ライン " + r.passScore + "点)</div>"
      + '<p class="subtitle">所要時間: ' + fmtDur(r.durationSec)
      + " &nbsp;|&nbsp; VM=実機 SSH 採点 / ○=満点 / △=半分 / ×・未採点=0点</p>"
      + (weakIds.length
        ? '<div class="exam-review-cta">'
          + '<div class="cta-text"><strong>次の一手</strong>'
          + ' &nbsp;満点が取れなかった ' + weakIds.length + ' 問を、'
          + 'すぐ復習セッションとして回せます。</div>'
          + reviewBtn
          + '</div>'
        : '<div class="exam-review-cta cta-perfect">'
          + '🏆 全問満点。次は別の模擬試験で確認しましょう。</div>')
      + "<h2>カテゴリ別</h2>" + catRows
      + "<h2>タスク別内訳</h2>"
      + '<table class="result-table"><thead><tr><th>#</th><th>カテゴリ</th>'
      + "<th>タイトル</th><th>採点</th><th>得点</th></tr></thead><tbody>"
      + rows + "</tbody></table>"
      + '<div class="navrow">'
      + reviewBtn
      + '<button data-hash="#exam">模擬試験一覧へ</button>'
      + '<button data-hash="#history">履歴を見る</button>'
      + '<span class="spacer"></span>'
      + '<button class="primary" data-hash="#home">ホームへ</button></div>';
    return {
      html: html,
      bind: function (root) {
        // 弱点復習ボタン (上下 2 ヶ所同じ) のクリックで review session を開始
        root.querySelectorAll('[data-role=review-weak]').forEach(function (btn) {
          btn.onclick = function () {
            if (!weakIds.length) return;
            global.App.session = {
              mode: "review",
              label: "復習（" + r.name + " の弱点）",
              baseHash: "#exam-result",
              list: weakIds.slice()
            };
            location.hash = "#q/" + weakIds[0];
          };
        });
      }
    };
  }
  function fmtDur(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + "分" + (s < 10 ? "0" : "") + s + "秒";
  }

  // =========================================================================
  // 分野別ドリル — カテゴリグリッド
  // =========================================================================
  function drillGrid() {
    var cards = CATEGORIES.map(function (c) {
      // 範囲外(legacy)を除いた公式問題のみで件数表示
      var official = QUESTIONS.filter(function (q) {
        return q.category === c.slug && !q.legacy;
      });
      var attempted = official.filter(function (q) {
        var rec = Progress.getQuestion(q.id);
        return rec && rec.selfGrade;
      }).length;
      return '<div class="card" data-hash="#drill/' + esc(c.slug) + '">'
        + "<h3>" + esc(c.label) + "</h3>"
        + '<div class="meta">' + esc(c.official) + "</div>"
        + '<div class="big" style="font-size:20px;margin-top:6px">'
        + attempted + " / " + official.length + " 問</div>"
        + '<div class="meta">&nbsp;</div></div>';
    }).join("");
    var officialTotal = QUESTIONS.filter(function (q) {
      return !q.legacy && q.test !== 7;
    }).length;
    cards += '<div class="card" data-hash="#random">'
      + "<h3>▶ 全分野からランダム</h3>"
      + '<div class="meta">公式 ' + officialTotal + ' 問</div>'
      + '<div class="big" style="font-size:18px;margin-top:6px">実力チェック</div>'
      + '<div class="meta">全分野からシャッフル出題。総復習に。</div></div>'
      + '<div class="card" data-hash="#random/wrong">'
      + "<h3>▶ 間違いからランダム</h3>"
      + '<div class="meta">復習</div>'
      + '<div class="big" style="font-size:18px;margin-top:6px">弱点つぶし</div>'
      + '<div class="meta">× を付けた問題からシャッフル出題。</div></div>';
    var html = "<h1>分野別ドリル</h1>"
      + '<p class="subtitle">RHCSA exam domains. Pick a category to drill its tasks. '
      + "(This demo runs on an original sample set.)</p>"
      + '<div class="grid">' + cards + "</div>";
    return { html: html, bind: null };
  }

  // =========================================================================
  // 分野別ドリル — 問題リスト
  // =========================================================================
  function drillList(slug) {
    var cat = CAT_MAP[slug];
    if (!cat) return notFound("カテゴリが見つかりません: " + slug);
    // 範囲外(legacy=ACL/VDO/Thin/Podman)は出題から除外（owner方針・データは保持）
    var list = QUESTIONS.filter(function (q) { return q.category === slug && !q.legacy; });
    var html = '<div class="crumbs"><a href="#drill">分野別ドリル</a> / '
      + esc(cat.label) + "</div>"
      + "<h1>" + esc(cat.label) + "</h1>"
      + '<p class="subtitle">' + esc(cat.official) + " — " + list.length + " 問</p>"
      + '<div class="toolbar">'
      + '<button data-role="startall" class="primary">最初から順に解く</button>'
      + "</div>"
      + '<div class="filter-chips">'
      +   '<label><input type="checkbox" data-filter="untouched"> 未着手</label>'
      +   '<label><input type="checkbox" data-filter="partial"> △ あやしい</label>'
      +   '<label><input type="checkbox" data-filter="wrong"> × できない</label>'
      +   '<label><input type="checkbox" data-filter="autograde"> VM採点対応</label>'
      + "</div>"
      + '<div class="qlist" data-role="qlist"></div>';
    return {
      html: html, bind: function (root) {
        var listEl = root.querySelector("[data-role=qlist]");
        var chips = root.querySelectorAll(".filter-chips input[type=checkbox]");
        function getChecks() {
          var c = {};
          chips.forEach(function (cb) {
            c[cb.getAttribute("data-filter")] = cb.checked;
          });
          return c;
        }
        function applyFilters(items) {
          var c = getChecks();
          var stateGroup = c.untouched || c.partial || c.wrong;
          var wrongSet = c.wrong ? new Set(Progress.wrongList()) : null;
          var partialSet = c.partial ? new Set(Progress.partialList()) : null;
          // 未着手は legacy も拾った上で hidelegacy フィルタで弾く
          var untouchedSet = c.untouched
            ? new Set(Progress.untouchedList(QUESTIONS, { includeLegacy: true }))
            : null;
          return items.filter(function (q) {
            if (c.autograde && !q.autoGradeReady) return false;
            if (stateGroup) {
              // 状態フィルタ群（未着手/あやしい/できない）は OR
              var match =
                (wrongSet && wrongSet.has(q.id)) ||
                (partialSet && partialSet.has(q.id)) ||
                (untouchedSet && untouchedSet.has(q.id));
              if (!match) return false;
            }
            return true;
          });
        }
        function draw() {
          var shown = applyFilters(list);
          listEl.innerHTML = shown.map(qRow).join("")
            || '<div class="empty">該当する問題がありません</div>';
          listEl.querySelectorAll(".qrow").forEach(function (row) {
            row.onclick = function () {
              global.App.session = {
                mode: "drill", label: cat.label + " ドリル",
                baseHash: "#drill/" + slug,
                list: shown.map(function (q) { return q.id; })
              };
              location.hash = "#q/" + row.getAttribute("data-qid");
            };
          });
        }
        chips.forEach(function (cb) { cb.onchange = draw; });
        root.querySelector("[data-role=startall]").onclick = function () {
          var shown = applyFilters(list);
          if (!shown.length) return;
          global.App.session = {
            mode: "drill", label: cat.label + " ドリル",
            baseHash: "#drill/" + slug,
            list: shown.map(function (q) { return q.id; })
          };
          location.hash = "#q/" + shown[0].id;
        };
        draw();
      }
    };
  }
  function qRow(q) {
    var rec = Progress.getQuestion(q.id);
    var g = rec && rec.selfGrade;
    var extra = q.test === 7
      ? '<span class="badge scope-extra" title="supplementary sample">extra</span>'
      : "";
    var vmReady = q.autoGradeReady
      ? '<span class="badge badge-vm" title="VM 採点対応">VM</span>'
      : "";
    return '<div class="qrow" data-qid="' + esc(q.id) + '">'
      + '<span class="qmark ' + gradeClass(g) + '">' + gradeSym(g) + "</span>"
      + '<span class="qid">T' + q.test + "Q" + q.qno + "</span>"
      + '<span class="qtitle">' + esc(q.title) + "</span>"
      + vmReady
      + extra
      + (q.legacy ? '<span class="badge legacy scope-legacy">発展</span>' : "")
      + '<span class="badge diff">難' + q.difficulty + "</span>"
      + "</div>";
  }

  // =========================================================================
  // ランダム出題 — 設定
  // =========================================================================
  function randomSetup(filter) {
    var isWrong = filter === "wrong";
    if (isWrong) {
      var wrongQs = Progress.wrongList()
        .map(function (id) { return Q_MAP[id]; })
        .filter(function (q) { return !!q; });
      if (!wrongQs.length) {
        return {
          html: '<div class="crumbs"><a href="#drill">分野別ドリル</a> / 間違いからランダム</div>'
            + "<h1>間違いからランダム</h1>"
            + '<div class="empty">間違えた問題がありません。<br>'
            + "問題を × で自己採点すると、ここからランダム復習できます。"
            + '<br><br><a href="#drill">分野別ドリルへ</a></div>',
          bind: null
        };
      }
    }
    var head = isWrong ? "間違いからランダム" : "ランダム出題";
    var sub = isWrong
      ? "× を付けた問題からシャッフルして出題します。弱点つぶしに。"
      : "Random questions from the sample set. Good for a quick review.";
    var html = '<div class="crumbs"><a href="#drill">分野別ドリル</a> / '
      + esc(head) + "</div>"
      + "<h1>" + esc(head) + "</h1>"
      + '<p class="subtitle">' + sub + "</p>"
      + '<div class="toolbar">'
      + "<label>出題数 "
      + '<select data-role="count"><option value="10">10問</option>'
      + '<option value="20" selected>20問</option>'
      + '<option value="30">30問</option>'
      + '<option value="0">全問シャッフル</option></select></label>'
      + (isWrong ? "" : '<label class="chk"><input type="checkbox" data-role="inclegacy"> '
        + "発展(legacy)問題を含める</label>")
      + "</div>"
      + '<div class="toolbar">'
      + '<button class="primary" data-role="start">出題開始</button></div>';
    return {
      html: html, bind: function (root) {
        root.querySelector("[data-role=start]").onclick = function () {
          var count = parseInt(root.querySelector("[data-role=count]").value, 10);
          var pool;
          if (isWrong) {
            pool = Progress.wrongList()
              .map(function (id) { return Q_MAP[id]; })
              .filter(function (q) { return !!q; });
          } else {
            var incEl = root.querySelector("[data-role=inclegacy]");
            var incLegacy = incEl && incEl.checked;
            pool = QUESTIONS.filter(function (q) {
              return incLegacy || !q.legacy;
            }).slice();
          }
          // Fisher-Yates
          for (var i = pool.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
          }
          if (count > 0) pool = pool.slice(0, count);
          if (!pool.length) return;
          global.App.session = {
            mode: "random",
            label: isWrong ? "間違いからランダム" : "ランダム出題",
            baseHash: isWrong ? "#random/wrong" : "#random",
            list: pool.map(function (q) { return q.id; })
          };
          location.hash = "#q/" + pool[0].id;
        };
      }
    };
  }

  // =========================================================================
  // 単問表示 (ドリル/ランダム/復習で共通)
  // =========================================================================
  function question(qid) {
    var q = Q_MAP[qid];
    if (!q) return notFound("問題が見つかりません: " + qid);
    var rec = Progress.getQuestion(qid) || {};
    var state = {
      revealed: !!rec.selfGrade,
      selfGrade: rec.selfGrade || null
    };
    var sess = global.App.session;
    var prevHash = "", nextHash = "", crumbs = "全問題", backHash = "#home";
    if (sess && sess.list) {
      backHash = sess.baseHash || "#home";
      var i = sess.list.indexOf(qid);
      if (i >= 0) {
        crumbs = sess.label + " — " + (i + 1) + " / " + sess.list.length;
        if (i > 0) prevHash = "#q/" + sess.list[i - 1];
        if (i < sess.list.length - 1) nextHash = "#q/" + sess.list[i + 1];
      }
    }
    var navHtml = '<div class="navrow big-navrow">'
      + (prevHash ? '<button data-nav="prev" class="big-nav-btn">← 前の問題</button>' : "")
      + '<span class="spacer"></span>'
      + (nextHash ? '<button data-nav="next" class="primary big-nav-btn big-nav-next">次の問題 →</button>'
        : '<button data-nav="back" class="big-nav-btn">一覧へ戻る</button>')
      + "</div>";
    var html = '<div class="crumbs">' + esc(crumbs)
      + ' &nbsp;|&nbsp; <a href="' + esc(backHash) + '">一覧へ戻る</a></div>'
      + '<div class="q-with-chat">'
      +   '<div class="q-main">'
      +     questionInteractiveHTML(q, state)
      +     navHtml
      +   '</div>'
      +   chatPaneHTML(qid)
      + '</div>';
    return {
      html: html, bind: function (root) {
        bindQuestionInteractive(root, q, {
          state: state,
          mode: "drill",
          onGrade: function (g) {
            Progress.recordQuestion(qid, g, sess ? sess.mode : "single");
          },
          onAutoGrade: function (scored) {
            // VM 採点を進捗 (selfGrade) にも反映する。手動評価は尊重する。
            Progress.recordAutoGradeAndSync(qid, scored, { ctx: "vm-auto" });
          },
          onReset: function () { Progress.clearQuestion(qid); }
        });
        var p = root.querySelector('[data-nav=prev]');
        if (p) p.onclick = function () { location.hash = prevHash; };
        var n = root.querySelector('[data-nav=next]');
        if (n) n.onclick = function () { location.hash = nextHash; };
        var b = root.querySelector('[data-nav=back]');
        if (b) b.onclick = function () { location.hash = backHash; };
        bindChatPane(root, qid);
      }
    };
  }

  // =========================================================================
  // AI チャットペイン（問題画面の右側）
  // =========================================================================
  // チャットの開閉状態を localStorage で保持（初期は閉じる）
  var CHAT_OPEN_KEY = "rhcsa10_chatopen_v1";
  function isChatOpen() {
    try { return global.localStorage.getItem(CHAT_OPEN_KEY) === "1"; }
    catch (e) { return false; }
  }
  function setChatOpen(v) {
    try { global.localStorage.setItem(CHAT_OPEN_KEY, v ? "1" : "0"); }
    catch (e) { /* */ }
  }

  function chatPaneHTML(qid) {
    var open = isChatOpen();
    var cls = "chat-pane" + (open ? " open" : " collapsed");
    return '<aside class="' + cls + '" data-qid="' + esc(qid) + '">'
      + '<button class="chat-toggle" data-role="chat-toggle" '
      +   'title="AI 家庭教師パネルの開閉 (キーボード: T)">'
      +   '<span class="chat-toggle-arrow">' + (open ? "▾" : "▸") + '</span>'
      +   '<span class="chat-toggle-label">AI 家庭教師</span>'
      +   '<span class="chat-toggle-hint">' + (open ? "閉じる" : "開く") + '</span>'
      + '</button>'
      + '<div class="chat-body" data-role="chat-body">'
      + '<div class="chat-head">'
      +   '<span class="chat-title">AI 家庭教師</span>'
      +   '<span class="chat-status" data-role="chat-status"></span>'
      + '</div>'
      + '<div class="chat-modes" data-role="chat-modes">'
      +   '<button class="chat-mode" data-mode="hint">ヒント</button>'
      +   '<button class="chat-mode active" data-mode="explain">解説</button>'
      +   '<button class="chat-mode" data-mode="debug">エラー診断</button>'
      + '</div>'
      + '<div class="chat-modehint" data-role="chat-modehint"></div>'
      + '<div class="chat-log" data-role="chat-log"></div>'
      + '<div class="chat-input-row">'
      +   '<textarea class="chat-input" data-role="chat-input" rows="2" '
      +     'placeholder="この問題について質問する… （Cmd/Ctrl+Enter で送信）"></textarea>'
      +   '<button class="chat-send" data-role="chat-send" title="送信">送信</button>'
      + '</div>'
      + '<div class="chat-foot">'
      +   '<button class="chat-clear" data-role="chat-clear" title="この問題のチャット履歴を消去">履歴クリア</button>'
      + '</div>'
      + '</div>'
      + '</aside>';
  }

  function renderMarkdownLite(text) {
    // 軽量 markdown：```code``` / 見出し## / 箇条書き- / 番号1. /
    // チェックリスト- [ ] / 水平線--- / `inline` / **bold** に対応。
    // XSS 対策：コードフェンスを退避 → 全体を esc → esc 済みテキストに対して
    // 行ベースでブロックを組み立てる（生 HTML を一切通さない）。
    var blocks = [];
    var src = String(text == null ? "" : text).replace(
      /```([a-z]*)\n([\s\S]*?)```/g,
      function (_, lang, code) {
        var idx = blocks.length;
        blocks.push('<pre><code class="lang-' + esc(lang || 'bash') + '">'
          + esc(code) + '</code></pre>');
        return '\n@@CB' + idx + '@@\n';   // 必ず独立行にする
      });
    // フェンス外を esc（プレースホルダ @@CB<n>@@ は記号を含まず素通り）
    src = esc(src);

    // インライン整形は esc 済みテキストにのみ作用（新たな生タグは導入しない）
    function inline(s) {
      return s
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    var lines = src.split('\n');
    var out = [];
    var listType = null;                  // "ul" | "ol" | null
    function closeList() {
      if (listType) { out.push('</' + listType + '>'); listType = null; }
    }
    function openList(type) {
      if (listType !== type) { closeList(); out.push('<' + type + '>'); listType = type; }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m;
      // コードフェンスのプレースホルダ（単独行）
      if (/^@@CB\d+@@$/.test(line.trim())) {
        closeList(); out.push(line.trim()); continue;
      }
      // 水平線（---, ***, ___ が3つ以上）
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        closeList(); out.push('<hr>'); continue;
      }
      // 見出し（# 〜 ######）→ チャット内なので h4/h5 に圧縮
      m = /^\s*(#{1,6})\s+(.*)$/.exec(line);
      if (m) {
        closeList();
        var lvl = m[1].length <= 2 ? 4 : 5;
        out.push('<h' + lvl + ' class="md-h">' + inline(m[2]) + '</h' + lvl + '>');
        continue;
      }
      // チェックリスト（- [ ] / - [x]）
      m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (m) {
        openList('ul');
        var done = m[1] !== ' ';
        out.push('<li class="md-task' + (done ? ' done' : '') + '">'
          + '<span class="md-box">' + (done ? '☑' : '☐') + '</span>'
          + '<span>' + inline(m[2]) + '</span></li>');
        continue;
      }
      // 箇条書き（- / * / +）
      m = /^\s*[-*+]\s+(.*)$/.exec(line);
      if (m) { openList('ul'); out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      // 番号リスト（1. 2. …）
      m = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (m) { openList('ol'); out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      // 空行 → 段落区切り
      if (line.trim() === '') { closeList(); continue; }
      // 通常行
      closeList();
      out.push('<div class="md-line">' + inline(line) + '</div>');
    }
    closeList();

    var html = out.join('\n');
    // フェンス復元（<pre> 内は改行を保持したまま戻す）
    html = html.replace(/@@CB(\d+)@@/g, function (_, i) { return blocks[+i]; });
    return html;
  }

  // 各モードの説明・入力プレースホルダ・空状態の例文（タブを押すと即反映）
  var MODE_INFO = {
    hint: {
      label: "ヒント",
      desc: "答えは見せず、考え方とヒントだけ返します。まず自力で解きたいとき。",
      ph: "ヒントが欲しい操作を書く… 例：「Host で始まる行だけ抜き出すには？」",
      examples: [
        '<div class="ce-ex">行頭が <code>Host</code> の行だけ抜き出すには？</div>',
        '<div class="ce-ex">コメント行を除くアプローチを教えて</div>'
      ]
    },
    explain: {
      label: "解説",
      desc: "コマンドを一つずつ、仕組みまで解説します。理解を深めたいとき。",
      ph: "分からないコマンド・概念を書く… 例：「grep -v って何？」",
      examples: [
        '<div class="ce-ex"><code>grep -v \'^#\'</code> の <code>-v</code> は？</div>',
        '<div class="ce-ex">リダイレクト <code>&gt;</code> と <code>&gt;&gt;</code> の違いは？</div>'
      ]
    },
    debug: {
      label: "エラー診断",
      desc: "実行して出たエラーを貼ると、原因と直し方を診断します。詰まったとき。",
      ph: "VM で出たエラー出力をそのまま貼る…",
      examples: [
        '<div class="ce-ex"><code>Permission denied</code> が出た（コマンドも貼る）</div>',
        '<div class="ce-ex">保存したファイルが空になる…</div>'
      ]
    }
  };

  // チャット接続状態ポーリングの id（同時に1画面のみ。再描画時に前回を解除してリーク防止）
  var chatStatusPoll = null;
  function bindChatPane(root, qid) {
    var pane = root.querySelector('.chat-pane');
    if (!pane) return;
    var toggleBtn = pane.querySelector('[data-role=chat-toggle]');
    var statusEl = pane.querySelector('[data-role=chat-status]');
    var modesEl = pane.querySelector('[data-role=chat-modes]');
    var logEl = pane.querySelector('[data-role=chat-log]');
    var inputEl = pane.querySelector('[data-role=chat-input]');
    var sendBtn = pane.querySelector('[data-role=chat-send]');
    var clearBtn = pane.querySelector('[data-role=chat-clear]');
    var modehintEl = pane.querySelector('[data-role=chat-modehint]');

    var currentMode = "explain";
    // 生成中の回答ごとに1回だけ「回答の先頭」へスクロールするためのキー
    var streamAnchorKey = null;

    // チャットの開閉トグル
    function applyOpenState(open) {
      pane.classList.toggle("open", open);
      pane.classList.toggle("collapsed", !open);
      if (toggleBtn) {
        var arrow = toggleBtn.querySelector(".chat-toggle-arrow");
        var hint = toggleBtn.querySelector(".chat-toggle-hint");
        if (arrow) arrow.textContent = open ? "▾" : "▸";
        if (hint) hint.textContent = open ? "閉じる" : "開く";
      }
      setChatOpen(open);
      if (open && inputEl) {
        // 開いた直後にフォーカスを入力欄へ
        setTimeout(function () { inputEl.focus(); }, 60);
      }
    }
    if (toggleBtn) {
      toggleBtn.onclick = function () {
        applyOpenState(!pane.classList.contains("open"));
      };
    }
    // 外部から T キーで開閉できるようハンドルを公開
    pane._toggleChat = function () {
      applyOpenState(!pane.classList.contains("open"));
    };

    function updateStatus() {
      // ペインが再描画で DOM から外れていたらポーリングを自己解除（デタッチ DOM への無駄打ち防止）
      if (!document.body.contains(pane)) {
        if (chatStatusPoll) { clearInterval(chatStatusPoll); chatStatusPoll = null; }
        return;
      }
      var ready = global.Chat && global.Chat.isReady();
      if (ready) {
        statusEl.textContent = "● 接続中";
        statusEl.className = "chat-status ok";
        sendBtn.disabled = false;
        inputEl.disabled = false;
        inputEl.placeholder = (MODE_INFO[currentMode] || MODE_INFO.explain).ph;
      } else {
        statusEl.textContent = "● 未接続";
        statusEl.className = "chat-status off";
        sendBtn.disabled = true;
        inputEl.disabled = true;
        var bridgeUp = global.Bridge && global.Bridge.bridgeUp;
        inputEl.placeholder = bridgeUp
          ? "vmbridge.config.json の anthropic_api_key を設定してください"
          : "vmbridge.py を起動してください";
      }
    }
    updateStatus();
    // Bridge 状態が変わったら追従。前回のポーリングを必ず解除してから張り直す（累積リーク防止）
    if (chatStatusPoll) clearInterval(chatStatusPoll);
    chatStatusPoll = setInterval(updateStatus, 5000);

    function renderHistory(opts) {
      opts = opts || {};
      // innerHTML を差し替える前に「ほぼ最下部か」を測る（追従するか判定）
      var nearBottom =
        (logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight) < 120;
      var hist = global.Chat.getHistory(qid);
      if (!hist.length) {
        var info0 = MODE_INFO[currentMode] || MODE_INFO.explain;
        // 見出し「✦ TUTOR からのヒント」は ::before、モード説明は説明バーが担うので、
        // ここはモード別の質問例だけを出す（重複回避）。
        logEl.innerHTML = '<div class="chat-empty">'
          + '<div class="ce-ex-h">質問例</div>'
          + info0.examples.join('')
          + '</div>';
        return;
      }
      logEl.innerHTML = hist.map(function (m) {
        var cls = "chat-msg " + (m.role === "user" ? "u" : "a");
        if (m.streaming) cls += " streaming";
        return '<div class="' + cls + '">'
          + '<div class="chat-msg-body">' + renderMarkdownLite(m.content) + '</div>'
          + '</div>';
      }).join("");
      // 生成中は最下部へ追従しない（画面が流れて、読み終わりに回答の先頭まで
      // 戻る手間をなくす）。最初のチャンクが来たとき1回だけ回答の先頭を
      // ログ上部に合わせ、以降は画面を固定する。
      var last = hist[hist.length - 1];
      if (last && last.streaming && last.content) {
        var key = qid + ":" + hist.length;
        if (streamAnchorKey !== key) {
          streamAnchorKey = key;
          var msgs = logEl.querySelectorAll(".chat-msg");
          var ansEl = msgs[msgs.length - 1];
          if (ansEl) {
            logEl.scrollTop = ansEl.getBoundingClientRect().top
              - logEl.getBoundingClientRect().top + logEl.scrollTop - 6;
          }
        }
        return;
      }
      // 初回／送信直後は強制で最下部へ。それ以外はユーザーが最下部付近にいるときだけ追従。
      if (opts.forceBottom || nearBottom) logEl.scrollTop = logEl.scrollHeight;
    }
    // モードを適用（押した瞬間に：タブ強調・説明・プレースホルダ・例文を更新）
    function applyMode(mode) {
      currentMode = mode;
      modesEl.querySelectorAll('.chat-mode').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === mode);
      });
      var info = MODE_INFO[mode] || MODE_INFO.explain;
      if (modehintEl) modehintEl.textContent = info.desc;
      // 接続中ならモード別プレースホルダ（未接続時は updateStatus の案内を優先）
      if (global.Chat && global.Chat.isReady()) inputEl.placeholder = info.ph;
      // 履歴が空なら例文もモードに合わせて差し替え
      if (!global.Chat.getHistory(qid).length) renderHistory();
    }
    applyMode(currentMode);
    renderHistory({ forceBottom: true });

    // モード切替（押した瞬間に説明・プレースホルダ・例文を更新＝即フィードバック）
    modesEl.querySelectorAll('.chat-mode').forEach(function (btn) {
      btn.onclick = function () { applyMode(btn.getAttribute('data-mode')); };
    });

    function scrollChatIntoView() {
      // スマホ等でチャットが画面外にあるとき、回答が出る場所を画面内へ。
      // 既に見えていれば block:"nearest" で無駄に動かさない。
      var body = pane.querySelector('[data-role=chat-body]') || logEl;
      if (body && body.scrollIntoView) {
        body.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    function doSend() {
      if (sendBtn.disabled) return;
      var text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = "";
      sendBtn.disabled = true;
      var streamBuf = "";
      global.Chat.send({
        qid: qid, mode: currentMode, userText: text,
        onChunk: function () {
          renderHistory();    // 履歴は send 内で更新済み（streaming フラグで描画）
        },
        onDone: function () {
          renderHistory();
          sendBtn.disabled = false;
          inputEl.focus();
        },
        onError: function (msg) {
          renderHistory();
          var div = document.createElement("div");
          div.className = "chat-msg err";
          div.innerHTML = '<div class="chat-msg-body">[エラー] ' + esc(msg) + '</div>';
          logEl.appendChild(div);
          logEl.scrollTop = logEl.scrollHeight;
          sendBtn.disabled = false;
          inputEl.focus();
        }
      });
      // 送信した瞬間に自分の質問＋これから出る回答エリアを表示し、
      // チャット（回答が出る場所）を画面内へスクロールする。
      renderHistory({ forceBottom: true });
      scrollChatIntoView();
    }
    sendBtn.onclick = doSend;
    inputEl.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        doSend();
      }
    });
    clearBtn.onclick = function () {
      if (global.confirm("この問題のチャット履歴を消去しますか？")) {
        global.Chat.clearHistory(qid);
        renderHistory();
      }
    };
  }

  // =========================================================================
  // 学習ガイド
  // =========================================================================
  function guidesList() {
    var cards = GUIDES.map(function (g) {
      return '<div class="card" data-hash="#guide/' + esc(g.slug) + '">'
        + "<h3>" + esc(g.title) + "</h3>"
        + '<div class="meta">' + esc(g.slug) + "</div></div>";
    }).join("");
    return {
      html: "<h1>学習ガイド</h1>"
        + '<p class="subtitle">分野別チートシート（概要 + 9分野）。'
        + "コマンドリファレンスと頻出パターンを収録。</p>"
        + '<div class="grid">' + cards + "</div>", bind: null
    };
  }
  function guide(slug) {
    var g = GUIDE_MAP[slug];
    if (!g) return notFound("ガイドが見つかりません: " + slug);
    return {
      html: '<div class="crumbs"><a href="#guides">学習ガイド</a> / '
        + esc(g.title) + "</div>"
        + '<div class="md">' + g.html + "</div>"
        + '<div class="navrow"><button data-hash="#guides">ガイド一覧へ</button></div>',
      bind: null
    };
  }

  // =========================================================================
  // 履歴・ダッシュボード
  // =========================================================================
  function history() {
    var st = Progress.stats(QUESTIONS);
    var cstat = Progress.categoryStats(QUESTIONS);
    var catRows = CATEGORIES.map(function (c) {
      var s = cstat[c.slug] || { attempted: 0, correct: 0, partial: 0, wrong: 0, total: 0 };
      var graded = s.correct + s.partial + s.wrong;
      var pct = graded ? Math.round((s.correct + s.partial * 0.5) / graded * 100) : 0;
      return '<div class="cat-stat"><span>' + esc(c.label) + "</span>"
        + '<div class="bar"><span style="width:' + pct + '%"></span></div>'
        + "<span>" + s.attempted + "/" + s.total + "</span></div>";
    }).join("");

    var exams = Progress.getExams().slice().reverse();
    var examRows = exams.length
      ? exams.map(function (e) {
        return "<tr><td>" + esc(e.name) + "</td>"
          + '<td style="text-align:right">' + e.score + "/" + e.totalScore + "</td>"
          + '<td style="text-align:center" class="' + (e.passed ? "g-correct" : "g-wrong")
          + '">' + (e.passed ? "合格" : "不合格") + "</td>"
          + "<td>" + fmtDur(e.durationSec) + "</td>"
          + "<td>" + esc((e.submittedAt || "").replace("T", " ").slice(0, 16)) + "</td></tr>";
      }).join("")
      : '<tr><td colspan="5" class="empty">まだ受験記録がありません</td></tr>';

    var today = renderTodayCards();
    var wrong = today.wrong;

    var wrongByCat = {};
    wrong.forEach(function (qid) {
      var q = Q_MAP[qid]; if (!q) return;
      (wrongByCat[q.category] = wrongByCat[q.category] || []).push(q);
    });
    var wrongHtml = "";
    Object.keys(wrongByCat).forEach(function (slug) {
      wrongHtml += "<h3>" + esc(CAT_MAP[slug] ? CAT_MAP[slug].label : slug) + " ("
        + wrongByCat[slug].length + ")</h3>";
      wrongHtml += '<div class="qlist">'
        + wrongByCat[slug].map(qRow).join("") + "</div>";
    });
    if (!wrong.length)
      wrongHtml = '<div class="empty">間違えた問題はありません。'
        + "（問題を × で自己採点するとここに表示されます）</div>";

    var html = "<h1>復習</h1>"
      + '<p class="subtitle">弱点から再挑戦。今日やる問題をここから選びます。</p>'
      + "<h2>今日やる</h2>" + today.html
      + '<div class="stat-row">'
      + statBox(st.attempted + "/" + st.total, "着手")
      + statBox(st.correct, "○ できた")
      + statBox(st.partial, "△ あやしい")
      + statBox(st.wrong, "× できない")
      + statBox(st.accuracy + "%", "正答率")
      + "</div>"
      + "<h2>カテゴリ別 正答率</h2>" + catRows
      + "<h2>模擬試験の記録</h2>"
      + '<table class="result-table"><thead><tr><th>試験</th><th>得点</th>'
      + "<th>判定</th><th>所要</th><th>日時</th></tr></thead><tbody>"
      + examRows + "</tbody></table>"
      + "<h2>間違えた問題一覧</h2>"
      + '<div class="toolbar">'
      + '<button class="danger" data-role="resetprog">進捗をすべて消去</button>'
      + "</div>"
      + '<div data-role="wrongwrap">' + wrongHtml + "</div>";

    return {
      html: html, bind: function (root) {
        bindTodayCards(root, today);
        root.querySelector("[data-role=resetprog]").onclick = function () {
          if (global.confirm("すべての進捗・履歴を消去します。よろしいですか？")) {
            Progress.reset();
            global.App.render();
          }
        };
        root.querySelectorAll(".qrow").forEach(function (row) {
          row.onclick = function () {
            global.App.session = {
              mode: "review", label: "復習（間違えた問題）",
              baseHash: "#history", list: wrong.slice()
            };
            location.hash = "#q/" + row.getAttribute("data-qid");
          };
        });
      }
    };
  }

  // ---- VM ブリッジ接続状態が変わったときの再装飾（main.js から呼ばれる） ----
  // 表示中の問題画面の .action-bar で autograde/check の primary を付け替えるだけ。
  // 画面を再描画しないのでスクロール位置や入力状態は保たれる。
  function refreshActionBar() {
    var connected = !!(global.Bridge && global.Bridge.connected);
    var bars = document.querySelectorAll("#app .action-bar");
    Array.prototype.forEach.call(bars, function (bar) {
      var ag = bar.querySelector("[data-role=autograde]");
      var ck = bar.querySelector("[data-role=check]");
      if (!ag || !ck) return;          // exam mode 等（check が無い）は対象外
      if (connected) {
        ag.classList.add("primary"); ck.classList.remove("primary");
      } else {
        ag.classList.remove("primary"); ck.classList.add("primary");
      }
    });
  }

  // ---- 公開 ----
  global.Screens = {
    home: home,
    examList: examList,
    examRun: examRun,
    examResult: examResult,
    drillGrid: drillGrid,
    drillList: drillList,
    randomSetup: randomSetup,
    question: question,
    guidesList: guidesList,
    guide: guide,
    history: history,
    refreshActionBar: refreshActionBar,
    notFound: notFound,
    _maps: { Q_MAP: Q_MAP, CAT_MAP: CAT_MAP }
  };
})(window);
