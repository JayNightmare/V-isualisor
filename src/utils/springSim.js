import * as THREE from "three";

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const qParent = new THREE.Quaternion();

// Verlet spring chain with the same parameters the exporter writes to VRMC_springBone.
export class SpringChain {
  constructor(bones, { stiffness = 0.8, gravityPower = 0.1, dragForce = 0.4 } = {}) {
    this.params = { stiffness, gravityPower, dragForce };
    this.joints = [];
    for (let i = 0; i < bones.length - 1; i++) {
      const bone = bones[i];
      const child = bones[i + 1];
      this.joints.push({
        bone,
        restQuat: bone.quaternion.clone(),
        restDir: child.position.clone().normalize(),
        length: child.position.length(),
        cur: new THREE.Vector3(),
        prev: new THREE.Vector3(),
      });
    }
    this.reset();
  }

  reset() {
    this.joints.forEach((j) => {
      j.bone.quaternion.copy(j.restQuat);
    });
    this.joints[0]?.bone.parent?.updateMatrixWorld(true);
    this.joints.forEach((j) => {
      j.bone.updateWorldMatrix(true, false);
      const child = j.bone.children[0];
      child.updateWorldMatrix(true, false);
      child.getWorldPosition(j.cur);
      j.prev.copy(j.cur);
    });
  }

  update(dt) {
    const { stiffness, gravityPower, dragForce } = this.params;
    for (const j of this.joints) {
      const { bone } = j;
      bone.parent.updateWorldMatrix(true, false);
      bone.parent.getWorldQuaternion(qParent);
      const restWorldQuat = qParent.clone().multiply(j.restQuat);
      const origin = tmpA.copy(bone.position).applyMatrix4(bone.parent.matrixWorld);

      const stiff = tmpB.copy(j.restDir).applyQuaternion(restWorldQuat).multiplyScalar(stiffness * dt);
      const next = j.cur
        .clone()
        .addScaledVector(j.cur.clone().sub(j.prev), 1 - dragForce)
        .add(stiff);
      next.y -= gravityPower * dt;
      next.sub(origin).normalize().multiplyScalar(j.length).add(origin);

      j.prev.copy(j.cur);
      j.cur.copy(next);

      const localDir = next.sub(origin).normalize().applyQuaternion(restWorldQuat.invert());
      bone.quaternion.copy(j.restQuat).multiply(new THREE.Quaternion().setFromUnitVectors(j.restDir, localDir));
      bone.updateMatrixWorld(true);
    }
  }
}
