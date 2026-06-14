/* bridge.js — SSH ブリッジ・クライアント
   vmbridge.py (http://127.0.0.1:8770) と通信し、VM の到達確認と実物採点を行う。
   ブリッジ未起動・VM 未到達のときは connected=false となり、UI は自己採点にフォールバックする。 */
(function (global) {
  "use strict";

  // ベース URL は index.html で `window.RHCSA_BRIDGE_BASE = "http://127.0.0.1:NNNN"`
  // を定義することで上書き可能。デフォルトは vmbridge.config.example.json と同じ 8770。
  var BASE = (typeof global.RHCSA_BRIDGE_BASE === "string"
    && global.RHCSA_BRIDGE_BASE) || "http://127.0.0.1:8770";

  var Bridge = {
    bridgeUp: false,    // vmbridge.py に到達できたか
    connected: false,   // さらに VM(SSH) にも到達できたか
    token: null,
    info: null,

    /* /status を叩いて状態を更新。常に resolve する（失敗時も例外を投げない）。 */
    checkStatus: function () {
      return fetch(BASE + "/status", { method: "GET" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          Bridge.bridgeUp = true;
          Bridge.connected = !!(d && d.ok);
          Bridge.token = (d && d.token) || null;
          Bridge.info = d || null;
          return d;
        })
        .catch(function () {
          Bridge.bridgeUp = false;
          Bridge.connected = false;
          Bridge.token = null;
          Bridge.info = null;
          return null;
        });
    },

    /* 1問を実物採点する。phase = "live" | "reboot"。
       戻り値: Promise<{ questionId, phase, results:[{id,exitCode}] }>。失敗時は reject。 */
    grade: function (questionId, phase) {
      return fetch(BASE + "/grade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RHCSA-Bridge-Token": Bridge.token || ""
        },
        body: JSON.stringify({ questionId: questionId, phase: phase || "live" })
      }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || ("HTTP " + r.status));
          return d;
        });
      });
    }
  };

  global.Bridge = Bridge;
})(window);
