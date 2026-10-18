# /// script
# requires-python = ">=3.11"
# dependencies = ["torch==2.8.0", "transformers==4.56.2", "numpy==2.3.3", "pillow==11.3.0"]
# ///
"""
Zero-shot scene tags for RawBoy Auto's exposure, tried offline before anything ships.

TinyCLIP (https://github.com/wkcn/TinyCLIP, MIT, weights on Hugging Face under MIT) embeds the photo; each tag is
a few text prompts against a few counter-prompts, so a tag's probability says how much more the photo looks like
it than like an ordinary scene. The text side never ships: prompts are embedded here, once.

Input: the JSON files the web harness writes (stats + the 512 px linear Rec.2020 copy as half floats). The model
sees that copy rendered as the camera exposed it (RawBoy's +0.7 EV base, a soft shoulder, sRGB), not normalised
to grey, so a night scene still looks dark and snow still looks bright.

    uv run tag.py <harness-out-dir>... --out tags.json

Not used by the apps yet: on the owner's 90 edited raws (two outings) the tags picked out snow, night and cats well,
but exposure shifts fitted from them (or from the whole embedding) did not hold up from one outing to the other.
"""
import argparse
import base64
import glob
import json
import os

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL = "wkcn/TinyCLIP-ViT-40M-32-Text-19M-LAION400M"

# tag -> (prompts, counter-prompts). Counter-prompts are the ordinary versions of the same kinds of photo.
TAGS = {
    "snow": (["a photo of a snowy landscape", "a photo of people in the snow", "a photo of a frozen lake covered in snow",
              "a photo of snow-covered trees"],
             ["a photo of a landscape", "a photo of people outdoors", "a photo of a lake", "a photo of trees"]),
    "bright": (["a bright high-key photo", "a photo of a white room full of daylight", "a photo of a bright window",
                "a photo of a beach with white sand"],
               ["a photo", "a photo of a room", "a photo of a wall", "a photo of a street"]),
    "night": (["a photo taken at night", "a photo of city lights at night", "a photo of a dark street at night",
               "a photo of a concert in the dark"],
              ["a photo taken during the day", "a photo of a city", "a photo of a street", "a photo of people"]),
    "lowkey": (["a dark moody photo", "a photo of a subject lit by a single sunbeam in a dark room",
                "a chiaroscuro photo with deep shadows", "a silhouette against the sky"],
               ["an evenly lit photo", "a photo of a room", "a photo of a person", "a photo of the sky"]),
    "sunset": (["a photo of a sunset", "a photo of the sun low on the horizon"],
               ["a photo of the sky", "a photo of a landscape"]),
    "tungsten": (["a photo of a room lit by warm lamps", "a photo by candlelight"],
                 ["a photo of a room in daylight", "a photo of a room"]),
    "cat": (["a photo of a cat", "a photo of a dog"], ["a photo of a person", "a photo of an object"]),
}


def half_to_float(b64: str, w: int, h: int) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64), dtype=np.float16).astype(np.float32).reshape(h, w, 3)


REC2020_TO_SRGB = np.array([[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]])


def render(lin: np.ndarray, normalise: bool) -> Image.Image:
    """The model's input: as the camera exposed it (+0.7 EV), or normalised to grey as the skin segmenter does."""
    rgb = np.maximum(lin @ REC2020_TO_SRGB.T, 0)
    if normalise:
        y = np.maximum(lin @ np.array([0.2627, 0.678, 0.0593]), 1e-5)
        k = 0.18 / np.exp(np.log(y).mean())
    else:
        k = 2 ** 0.7
    v = rgb * k
    t = v / (1 + v) * 1.6
    e = np.where(t <= 0.0031308, t * 12.92, 1.055 * np.power(np.clip(t, 0, None), 1 / 2.4) - 0.055)
    return Image.fromarray((np.clip(e, 0, 1) * 255 + 0.5).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--out", default="tags.json")
    ap.add_argument("--normalise", action="store_true")
    ap.add_argument("--save-inputs", help="directory to save the rendered model inputs to")
    args = ap.parse_args()

    model = CLIPModel.from_pretrained(MODEL).eval()
    proc = CLIPProcessor.from_pretrained(MODEL)
    with torch.no_grad():
        text = {}
        for tag, (pos, neg) in TAGS.items():
            e = model.get_text_features(**proc(text=pos + neg, return_tensors="pt", padding=True))
            e = e / e.norm(dim=-1, keepdim=True)
            text[tag] = (e[: len(pos)].mean(0), e[len(pos):].mean(0))
    scale = model.logit_scale.exp().item()

    out = {}
    for d in args.dirs:
        for j in sorted(glob.glob(os.path.join(d, "*.json"))):
            name = os.path.basename(j)[:-5]
            b = json.load(open(j))["base"]
            img = render(half_to_float(b["f16"], b["width"], b["height"]), args.normalise)
            if args.save_inputs:
                os.makedirs(args.save_inputs, exist_ok=True)
                img.save(os.path.join(args.save_inputs, name + ".jpg"), quality=90)
            with torch.no_grad():
                f = model.get_image_features(**proc(images=img, return_tensors="pt"))
                f = (f / f.norm(dim=-1, keepdim=True))[0]
            tags = {}
            for tag, (p, n) in text.items():
                lp, ln_ = scale * float(f @ (p / p.norm())), scale * float(f @ (n / n.norm()))
                tags[tag] = 1 / (1 + np.exp(ln_ - lp))
            out[name] = {"tags": tags, "embedding": f.tolist()}
            print(name[:28], " ".join(f"{k} {v:.2f}" for k, v in tags.items()))
    json.dump(out, open(args.out, "w"))


if __name__ == "__main__":
    main()
