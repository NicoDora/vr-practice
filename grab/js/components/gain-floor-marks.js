// 바닥에 1 m 간격 거리 눈금을 그린다. (rig 안에 두면 사용자가 이동해도 발 기준으로 따라온다)
// 1 m와 6 m는 거리 계수가 오르기 시작하고 최대가 되는 경계라서 다른 색으로 표시한다.
// 눈금은 발 기준 수평 거리이고, 배율 계산에 쓰는 거리는 어깨~물체 거리라 조금 다를 수 있다.
AFRAME.registerComponent("gain-floor-marks", {
  schema: {
    from: { default: 1 }, // m
    to: { default: 8 }, // m
    width: { default: 5 }, // m, 선 길이
    labelX: { default: -2.9 }, // m, 숫자 표지판 위치 (선 왼쪽 끝 바깥)
  },

  init: function () {
    var data = this.data;
    var C = GainTest.COLORS;
    this.group = new THREE.Group();
    this.panels = [];

    for (var d = data.from; d <= data.to; d++) {
      var isEdge = d === 1 || d === 6;
      var line = new THREE.Mesh(
        new THREE.PlaneGeometry(data.width, isEdge ? 0.04 : 0.025),
        new THREE.MeshBasicMaterial({
          color: isEdge ? C.teal : C.white,
          transparent: true,
          opacity: isEdge ? 0.95 : 0.7,
          depthWrite: false,
        }),
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.004, -d);
      this.group.add(line);

      // 멀수록 크게 만들어 화면에서 비슷한 크기로 보이게 한다.
      var scale = Math.max(1, d / 2.5);
      var panel = new GainTest.CanvasPanel(0.5 * scale, 0.22 * scale, 400);
      var label = d + " m";
      var note = d === 1 ? "거리 계수 시작" : d === 6 ? "거리 계수 최대" : "";
      panel.draw(label + note, function (ctx, w, h) {
        GainTest.roundRect(ctx, 4, 4, w - 8, h - 8, 28, isEdge ? C.teal : "rgba(26,29,58,0.75)");
        ctx.fillStyle = C.white;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (note) {
          GainTest.font(ctx, 64, true);
          ctx.fillText(label, w / 2, h * 0.36);
          GainTest.font(ctx, 36, false);
          ctx.fillText(note, w / 2, h * 0.74);
        } else {
          GainTest.font(ctx, 84, true);
          ctx.fillText(label, w / 2, h / 2);
        }
      });
      panel.mesh.position.set(data.labelX, 0.11 * scale + 0.02, -d);
      this.group.add(panel.mesh);
      this.panels.push(panel);
    }

    this.el.setObject3D("floor-marks", this.group);
  },

  remove: function () {
    this.panels.forEach(function (panel) {
      panel.dispose();
    });
    this.el.removeObject3D("floor-marks");
  },
});
