// 잡을 수 있는 오브젝트의 호버/잡힘 색을 담당한다.
// (A-Frame에 이미 grabbable이라는 내장 컴포넌트가 있어서 grab-highlight라는 이름을 쓴다)
// 마우스(mouse-grabbable), 컨트롤러(vr-grabber), 손(hand-grabber)은 모두
// el.addState("grabbed") / el.removeState("grabbed")로 잡힘 상태를 바꾸고,
// 호버는 각 cursor가 보내는 mouseenter / mouseleave로 알려 준다.
AFRAME.registerComponent("grab-highlight", {
  init: function () {
    var el = this.el;
    var material = el.getAttribute("material");
    var originalColor =
      material && material.color ? material.color : "#FFF";
    var hoverColor = "rgb(215, 123, 31)";
    var grabColor = "#EF2D5E";
    var hoverCursors = []; // 마우스, 양손 레이저가 동시에 가리킬 수 있어 cursor 목록으로 관리

    // 잡힘/호버 상태에 따라 색을 한곳에서 정한다.
    function updateColor() {
      var color = originalColor;
      if (el.is("grabbed")) color = grabColor;
      else if (hoverCursors.length) color = hoverColor;
      el.setAttribute("material", "color", color);
    }

    this.onMouseEnter = function (event) {
      var cursorEl = event.detail && event.detail.cursorEl;
      if (hoverCursors.indexOf(cursorEl) === -1) hoverCursors.push(cursorEl);
      updateColor();
    };

    this.onMouseLeave = function (event) {
      var cursorEl = event.detail && event.detail.cursorEl;
      var index = hoverCursors.indexOf(cursorEl);
      if (index !== -1) hoverCursors.splice(index, 1);
      updateColor();
    };

    this.onStateChange = function (event) {
      if (event.target === el && event.detail === "grabbed") updateColor();
    };

    el.addEventListener("mouseenter", this.onMouseEnter);
    el.addEventListener("mouseleave", this.onMouseLeave);
    el.addEventListener("stateadded", this.onStateChange);
    el.addEventListener("stateremoved", this.onStateChange);
  },

  remove: function () {
    this.el.removeEventListener("mouseenter", this.onMouseEnter);
    this.el.removeEventListener("mouseleave", this.onMouseLeave);
    this.el.removeEventListener("stateadded", this.onStateChange);
    this.el.removeEventListener("stateremoved", this.onStateChange);
  },
});
