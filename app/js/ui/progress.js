/* progress.js — localStorage 進捗ストア
   自己採点 (correct/partial/wrong) と模擬試験結果 (recordExam) を保存。
   模擬試験は VM 一括採点モードのときも同じ recordExam に格納され、
   results[].source ("vm-auto"/"vm-error"/"self") と results[].vmGrade で
   採点ソースを区別できる。 */
(function (global) {
  "use strict";

  var KEY = "rhcsa10_progress_v1";

  var DEFAULT = {
    version: 1,
    questions: {},   // qid -> { selfGrade, reviewedAt, attemptCount }
    log: [],         // [{ qid, selfGrade, ctx, at }] 追記型
    exams: []        // [{ examId, name, startedAt, submittedAt, durationSec,
                     //    totalScore, score, passed, results:[{qid,selfGrade,points,earned}] }]
  };

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULT);
      var data = JSON.parse(raw);
      if (!data || data.version !== 1) return clone(DEFAULT);
      data.questions = data.questions || {};
      data.log = data.log || [];
      data.exams = data.exams || [];
      return data;
    } catch (e) {
      return clone(DEFAULT);
    }
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var state = load();

  function persist() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("localStorage 保存に失敗:", e);
    }
  }

  var Progress = {
    /* 1問の自己採点を記録 */
    recordQuestion: function (qid, selfGrade, ctx) {
      var now = new Date().toISOString();
      var q = state.questions[qid] || { attemptCount: 0 };
      q.selfGrade = selfGrade;
      q.reviewedAt = now;
      q.attemptCount = (q.attemptCount || 0) + 1;
      state.questions[qid] = q;
      state.log.push({ qid: qid, selfGrade: selfGrade, ctx: ctx || "", at: now });
      if (state.log.length > 2000) state.log = state.log.slice(-2000);
      persist();
    },

    getQuestion: function (qid) {
      return state.questions[qid] || null;
    },

    /* 自動採点(VM ブリッジ)の結果を記録。phase("live"/"reboot") ごとに保存する。 */
    recordAutoGrade: function (qid, result) {
      var now = new Date().toISOString();
      var q = state.questions[qid] || { attemptCount: 0 };
      q.autoGrade = q.autoGrade || {};
      q.autoGrade[result.phase || "live"] = {
        earned: result.earned, max: result.max,
        perCheck: result.perCheck, at: now
      };
      state.questions[qid] = q;
      persist();
    },

    /* VM 採点 + selfGrade への自動反映（復習・正答率に反映するため）。
       手動で付けた selfGrade（selfGradeSource !== "vm-auto"）は尊重して
       上書きしない。VM 由来の古い評価は再採点で上書きできる。 */
    recordAutoGradeAndSync: function (qid, scored, opts) {
      this.recordAutoGrade(qid, scored);
      var q = state.questions[qid] || { attemptCount: 0 };
      if (q.selfGrade && q.selfGradeSource !== "vm-auto") return;
      if (!scored.max) return;
      var grade = scored.earned >= scored.max ? "correct"
                : scored.earned > 0          ? "partial"
                :                              "wrong";
      var now = new Date().toISOString();
      q.selfGrade = grade;
      q.selfGradeSource = "vm-auto";
      q.reviewedAt = now;
      q.attemptCount = (q.attemptCount || 0) + 1;
      state.questions[qid] = q;
      state.log.push({
        qid: qid, selfGrade: grade,
        ctx: (opts && opts.ctx) || "vm-auto",
        at: now
      });
      if (state.log.length > 2000) state.log = state.log.slice(-2000);
      persist();
    },

    /* 模擬試験の結果を記録 */
    recordExam: function (rec) {
      state.exams.push(rec);
      if (state.exams.length > 100) state.exams = state.exams.slice(-100);
      persist();
    },

    getExams: function () { return state.exams.slice(); },

    /* 全体統計 */
    stats: function (allQuestions) {
      var attempted = 0, correct = 0, partial = 0, wrong = 0;
      for (var qid in state.questions) {
        if (!state.questions.hasOwnProperty(qid)) continue;
        var g = state.questions[qid].selfGrade;
        if (!g) continue;
        attempted++;
        if (g === "correct") correct++;
        else if (g === "partial") partial++;
        else if (g === "wrong") wrong++;
      }
      var total = allQuestions ? allQuestions.length : 0;
      var graded = correct + partial + wrong;
      var accuracy = graded ? Math.round((correct + partial * 0.5) / graded * 100) : 0;
      return {
        total: total, attempted: attempted,
        correct: correct, partial: partial, wrong: wrong,
        accuracy: accuracy
      };
    },

    /* カテゴリ別統計 { slug: {attempted, correct, partial, wrong, total} } */
    categoryStats: function (allQuestions) {
      var out = {};
      allQuestions.forEach(function (q) {
        if (!out[q.category]) out[q.category] = { attempted: 0, correct: 0, partial: 0, wrong: 0, total: 0 };
        out[q.category].total++;
        var rec = state.questions[q.id];
        if (rec && rec.selfGrade) {
          out[q.category].attempted++;
          out[q.category][rec.selfGrade]++;
        }
      });
      return out;
    },

    /* 間違えた問題 (最新の自己採点が wrong) の qid 配列 */
    wrongList: function () {
      var out = [];
      for (var qid in state.questions) {
        if (!state.questions.hasOwnProperty(qid)) continue;
        if (state.questions[qid].selfGrade === "wrong") out.push(qid);
      }
      return out;
    },

    /* 部分点 (partial) の qid 配列 */
    partialList: function () {
      var out = [];
      for (var qid in state.questions) {
        if (!state.questions.hasOwnProperty(qid)) continue;
        if (state.questions[qid].selfGrade === "partial") out.push(qid);
      }
      return out;
    },

    /* 未着手 (記録が無い) 問題の qid 配列。既定で legacy を除外する。 */
    untouchedList: function (allQuestions, opts) {
      opts = opts || {};
      var includeLegacy = !!opts.includeLegacy;
      var out = [];
      (allQuestions || []).forEach(function (q) {
        if (!includeLegacy && q.legacy) return;
        var rec = state.questions[q.id];
        if (!rec || !rec.selfGrade) out.push(q.id);
      });
      return out;
    },

    /* VM 採点（live phase）を実施したことのある問題数 */
    vmGradedCount: function () {
      var n = 0;
      for (var qid in state.questions) {
        if (!state.questions.hasOwnProperty(qid)) continue;
        var ag = state.questions[qid].autoGrade;
        if (ag && (ag.live || ag.reboot)) n++;
      }
      return n;
    },

    /* 公式範囲（legacy=false）に絞った合格準備サマリ。
       score = (correct + partial * 0.5) / official_total * 100 */
    officialSummary: function (allQuestions) {
      var official = (allQuestions || []).filter(function (q) { return !q.legacy; });
      var attempted = 0, correct = 0, partial = 0;
      official.forEach(function (q) {
        var rec = state.questions[q.id];
        if (!rec || !rec.selfGrade) return;
        attempted++;
        if (rec.selfGrade === "correct") correct++;
        else if (rec.selfGrade === "partial") partial++;
      });
      return {
        total: official.length,
        attempted: attempted,
        correct: correct,
        partial: partial,
        score: official.length
          ? Math.round((correct + partial * 0.5) / official.length * 100)
          : 0
      };
    },

    /* 模擬試験の最高得点 (試験 ID ごと) と全体最高 */
    examBest: function () {
      var byId = {};
      var overall = null;
      state.exams.forEach(function (e) {
        if (byId[e.examId] == null || e.score > byId[e.examId].score)
          byId[e.examId] = { score: e.score, totalScore: e.totalScore, name: e.name };
        if (overall == null || e.score > overall.score)
          overall = { score: e.score, totalScore: e.totalScore, name: e.name };
      });
      return { byId: byId, overall: overall, count: state.exams.length };
    },

    /* 全消去 */
    reset: function () {
      state = clone(DEFAULT);
      persist();
    },

    /* 1問の記録をクリア (リセットボタン用) */
    clearQuestion: function (qid) {
      delete state.questions[qid];
      persist();
    },

    /* 高精度採点(Class A)で VM 実物採点まで完了した問題数 */
    highPrecisionCompleted: function (allQuestions) {
      var qmap = {};
      (allQuestions || []).forEach(function (q) { qmap[q.id] = q; });
      var done = 0, total = 0;
      (allQuestions || []).forEach(function (q) {
        if (q.graderQuality === "A" && !q.legacy) {
          total++;
          var rec = state.questions[q.id];
          if (rec && rec.autoGrade && rec.autoGrade.live) done++;
        }
      });
      return { done: done, total: total };
    },

    /* 当日(ローカル日付)の学習量 — 採点ログ件数 */
    todayCompleted: function () {
      var today = localDateKey(new Date());
      var qids = {};
      state.log.forEach(function (e) {
        var d = localDateKey(new Date(e.at));
        if (d === today) qids[e.qid] = true;
      });
      return Object.keys(qids).length;
    },

    /* 連続学習 streak — 直近何日連続で 1 問以上記録があるか */
    streak: function () {
      var dates = {};
      state.log.forEach(function (e) {
        dates[localDateKey(new Date(e.at))] = true;
      });
      var d = new Date();
      var n = 0;
      // 今日に記録がなければ昨日から数える（朝に減らないよう猶予）
      if (!dates[localDateKey(d)]) {
        d.setDate(d.getDate() - 1);
      }
      while (dates[localDateKey(d)]) {
        n++;
        d.setDate(d.getDate() - 1);
      }
      return n;
    },

    /* カテゴリ別の到達ランク(Bronze/Silver/Gold/ExamReady) と進捗 */
    categoryRanks: function (allQuestions) {
      var byCat = {};
      (allQuestions || []).forEach(function (q) {
        if (q.legacy) return;
        if (!byCat[q.category]) byCat[q.category] = { total: 0, correct: 0, partial: 0 };
        byCat[q.category].total++;
        var rec = state.questions[q.id];
        if (rec && rec.selfGrade === "correct") byCat[q.category].correct++;
        else if (rec && rec.selfGrade === "partial") byCat[q.category].partial++;
      });
      var out = {};
      Object.keys(byCat).forEach(function (slug) {
        var c = byCat[slug];
        var score = c.total ? (c.correct + c.partial * 0.5) / c.total : 0;
        var rank = "none";
        if (score >= 1.0) rank = "exam-ready";
        else if (score >= 0.75) rank = "gold";
        else if (score >= 0.5) rank = "silver";
        else if (score >= 0.25) rank = "bronze";
        out[slug] = {
          rank: rank,
          score: Math.round(score * 100),
          correct: c.correct, partial: c.partial, total: c.total
        };
      });
      return out;
    },

    /* 同カテゴリで × か △ な問題の qid 配列（次アクション用） */
    weakInCategory: function (slug, allQuestions, excludeQid) {
      var out = [];
      (allQuestions || []).forEach(function (q) {
        if (q.category !== slug) return;
        if (q.id === excludeQid) return;
        var rec = state.questions[q.id];
        if (rec && (rec.selfGrade === "wrong" || rec.selfGrade === "partial")) {
          out.push(q.id);
        }
      });
      return out;
    },

    /* 公開: 最近の log（テスト用） */
    _state: function () { return state; }
  };

  function localDateKey(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  global.Progress = Progress;
})(window);
