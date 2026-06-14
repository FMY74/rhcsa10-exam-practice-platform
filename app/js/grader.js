/* grader.js — スコア集計
   ブリッジが返した check 別の exitCode を、問題の grader 定義（questions.js 由来）と
   突き合わせて perCheck / earned / max を算出する。終了コード 0 = 合格。 */
(function (global) {
  "use strict";

  var Grader = {
    /* question: QUESTIONS の1件
       bridgeResult: { questionId, phase, results:[{id,exitCode}] }
       戻り値: { phase, perCheck:[{id,label,scope,passed,score,earned,exitCode}], earned, max } */
    score: function (question, bridgeResult) {
      var phase = (bridgeResult && bridgeResult.phase) || "live";
      var checks = (question.grader && question.grader.checks) || [];
      var byId = {};
      ((bridgeResult && bridgeResult.results) || []).forEach(function (r) {
        byId[r.id] = r;
      });
      var perCheck = [];
      var earned = 0, max = 0;
      checks.forEach(function (c) {
        if (c.scope !== phase) return;          // 要求 phase の check のみ集計
        var res = byId[c.id];
        var passed = !!res && res.exitCode === 0;
        var sc = (typeof c.score === "number") ? c.score : 0;
        max += sc;
        if (passed) earned += sc;
        perCheck.push({
          id: c.id, label: c.label || c.id, scope: c.scope,
          passed: passed, score: sc, earned: passed ? sc : 0,
          exitCode: res ? res.exitCode : null
        });
      });
      return { phase: phase, perCheck: perCheck, earned: earned, max: max };
    },

    /* この問題に reboot scope の check があるか */
    hasRebootChecks: function (question) {
      var checks = (question.grader && question.grader.checks) || [];
      return checks.some(function (c) { return c.scope === "reboot"; });
    }
  };

  global.Grader = Grader;
})(window);
