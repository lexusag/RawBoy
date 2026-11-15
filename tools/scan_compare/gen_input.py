import random
import numpy as np

W, H = 96, 64
random.seed(7)
img = np.zeros((H, W, 3), dtype=np.float32)
for y in range(H):
    for x in range(W):
        base = 0.05 + 0.5 * (x / W) + 0.2 * (y / H)
        if 30 <= x < 60 and 20 <= y < 44:
            base = 0.8  # a bright square (edges)
        if (x // 4 + y // 4) % 2 == 0 and x > 64:
            base *= 0.6  # a checker
        n = random.gauss(0, 0.01)
        img[y, x] = [max(base + n, 0), max(base * 0.8 + n, 0), max(base * 0.5 + n, 0)]
halves = np.zeros((H, W, 4), dtype=np.float16)
halves[..., :3] = img.astype(np.float16)
halves[..., 3] = np.float16(1)
halves.view(np.uint16).tofile('in.f16')
