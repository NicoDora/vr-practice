/* global AFRAME THREE */
// A-Painter(A-Frame 1.3)의 핸드트래킹 손 모델을 A-Frame 1.5 이후에 쓰는 v4 모델로 바꾼다.
//
// 1.3의 v3 모델은 뼈 이름과 위치가 WebXR 관절과 맞지 않아서(뼈 이름 변환표 사용, cm 단위),
// 실제 손 관절 위치를 넣으면 엄지와 검지 사이가 푹 들어가는 등 모양이 일그러진다.
// v4 모델은 뼈 이름이 WebXR 관절 이름과 같고 단위도 m라서, 관절 자세를 그대로 넣으면 된다.
// (1·2주차 오브젝트 잡기 페이지의 A-Frame 1.8도 이 모델을 쓴다)
(function () {
  var MODEL_URLS = {
    left: 'https://cdn.aframe.io/controllers/oculus-hands/v4/left.glb',
    right: 'https://cdn.aframe.io/controllers/oculus-hands/v4/right.glb'
  };
  // A-Frame 1.3은 관절 좌표를 y로 1.5m 내린 기준 공간에서 읽으므로 모델을 그만큼 올려 둔다.
  var REFERENCE_SPACE_OFFSET_Y = 1.5;

  var proto = AFRAME.components['hand-tracking-controls'].Component.prototype;

  proto.initMeshHandModel = function () {
    this.el.setAttribute('gltf-model', MODEL_URLS[this.data.hand]);
  };

  proto.onModelLoaded = function () {
    var mesh = this.mesh = this.el.getObject3D('mesh').children[0];
    var skinnedMesh = this.skinnedMesh = mesh.getObjectByProperty('type', 'SkinnedMesh');
    if (!skinnedMesh) { return; }
    this.bones = skinnedMesh.skeleton.bones;
    this.el.removeObject3D('mesh');
    mesh.position.set(0, REFERENCE_SPACE_OFFSET_Y, 0);
    mesh.rotation.set(0, 0, 0);
    skinnedMesh.frustumCulled = false;
    skinnedMesh.material = new THREE.MeshStandardMaterial({ color: this.data.modelColor });
    this.el.setObject3D('mesh', mesh);
  };

  proto.updateHandMeshModel = function () {
    var frame = this.el.sceneEl.frame;
    var trackedControls = this.el.components['tracked-controls'];
    var controller = trackedControls && trackedControls.controller;
    var referenceSpace = this.referenceSpace;
    if (!controller || !this.mesh || !referenceSpace) { return; }

    this.mesh.visible = false;
    for (var joint of controller.hand.values()) {
      var bone = this.getBone(joint.jointName);
      var pose = frame.getJointPose(joint, referenceSpace);
      if (!bone || !pose) { continue; }
      this.mesh.visible = true;
      bone.position.copy(pose.transform.position);
      bone.quaternion.copy(pose.transform.orientation);
    }
  };
})();
