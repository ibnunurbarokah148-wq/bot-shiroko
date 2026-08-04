def vec3_to_str(v):
    if not v:
        return "x: ?, y: ?, z: ?"
    return f"x: {v['x']:.3f}, y: {v['y']:.3f}, z: {v['z']:.3f}"


def vec3_to_dict(v):
    if not v:
        return {"x": 0, "y": 0, "z": 0}
    return {"x": v["x"], "y": v["y"], "z": v["z"]}
