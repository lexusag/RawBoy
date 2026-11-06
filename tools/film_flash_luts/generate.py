# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.24", "scipy>=1.10"]
# ///
"""
Generates RawBoy's bundled film flash LUTs (<repo>/luts/Film Flash*.cube).

Matches digital raw development (calibrated against Fujifilm raw + AgX)
to 35mm color negative film scanned on a Noritsu HS-1800 minilab scanner under direct flash.

1. "Film Flash": Direct match to on-camera flash film scans, including flash exposure
   lift, cadmium red dye purity, golden peach skin tones, and cool high-key Noritsu scan background.
2. "Film Flash Normal": Universal film stock look at standard exposure, preserving the film
   color matrix, red dye separation, and film tone curve without forcing an artificial exposure boost.

Usage:
    uv run tools/film_flash_luts/generate.py
"""

from pathlib import Path
import numpy as np

LUT_DIR = Path(__file__).resolve().parents[2] / "luts"
LUT_SIZE = 33


def build_lut(mode: str = "match", n: int = LUT_SIZE) -> np.ndarray:
    """Builds a 3D LUT table of shape (n, n, n, 3) in [b][g][r] order."""
    r = np.linspace(0, 1, n, dtype=np.float32)
    g = np.linspace(0, 1, n, dtype=np.float32)
    b = np.linspace(0, 1, n, dtype=np.float32)

    grid_b, grid_g, grid_r = np.meshgrid(b, g, r, indexing="ij")
    rgb = np.stack([grid_r, grid_g, grid_b], axis=-1)

    r_ch = rgb[..., 0]
    g_ch = rgb[..., 1]
    b_ch = rgb[..., 2]

    # 1. Red channel / dye purity (removing green & blue contamination from digital reds)
    red_dominance = np.maximum(0, r_ch - np.maximum(g_ch, b_ch))
    g_clean = g_ch - 0.65 * red_dominance * g_ch
    b_clean = b_ch - 0.85 * red_dominance * b_ch
    r_clean = r_ch + 0.18 * red_dominance * (1.0 - np.abs(r_ch - 0.6))

    rgb_clean = np.clip(np.stack([r_clean, g_clean, b_clean], axis=-1), 0, 1)

    # 2. Oklab transform for uniform perceptual adjustments
    mask = rgb_clean > 0.04045
    lin = np.zeros_like(rgb_clean)
    lin[mask] = ((rgb_clean[mask] + 0.055) / 1.055) ** 2.4
    lin[~mask] = rgb_clean[~mask] / 12.92

    l_lms = 0.4122214708 * lin[..., 0] + 0.5363325363 * lin[..., 1] + 0.0514459929 * lin[..., 2]
    m_lms = 0.2119034982 * lin[..., 0] + 0.6806995451 * lin[..., 1] + 0.1073969566 * lin[..., 2]
    s_lms = 0.0883024619 * lin[..., 0] + 0.2817188376 * lin[..., 1] + 0.6299787005 * lin[..., 2]

    l_ = np.cbrt(l_lms)
    m_ = np.cbrt(m_lms)
    s_ = np.cbrt(s_lms)

    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    b_lab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_

    C = np.sqrt(a**2 + b_lab**2)
    h_deg = np.degrees(np.arctan2(b_lab, a)) % 360

    if mode == "match":
        # Tone curve tailored to match the flash exposure from the digital raw
        xp = [0.00, 0.06, 0.15, 0.28, 0.45, 0.62, 0.78, 0.90, 1.00]
        fp = [0.005, 0.04, 0.14, 0.38, 0.68, 0.82, 0.91, 0.96, 1.00]
        L_base = np.interp(L, xp, fp)

        w_wall = np.exp(-((h_deg - 238) / 35) ** 2) * np.exp(-((C - 0.02) / 0.025) ** 2) * (L > 0.2)
        L_out = L_base + 0.12 * w_wall

        w_red = np.exp(-((h_deg - 28) / 25) ** 2) * np.clip((C - 0.05) / 0.08, 0, 1)
        L_out = L_out * (1.0 - 0.15 * w_red)

        C_factor = np.ones_like(C)
        h_shift = np.zeros_like(h_deg)

        C_factor += 0.30 * w_red
        h_shift += 5.0 * w_red

        w_skin = np.exp(-((h_deg - 42) / 18) ** 2) * (C < 0.06) * (L > 0.45)
        C_factor += 0.15 * w_skin
        h_shift += 4.5 * w_skin

        C_factor += 0.40 * w_wall

    elif mode == "universal":
        # Standard film negative tone curve (S-curve) without heavy artificial exposure boost
        xp = [0.00, 0.08, 0.20, 0.35, 0.50, 0.65, 0.80, 0.92, 1.00]
        fp = [0.008, 0.06, 0.17, 0.34, 0.52, 0.69, 0.84, 0.94, 0.99]
        L_base = np.interp(L, xp, fp)
        L_out = L_base

        w_red = np.exp(-((h_deg - 28) / 25) ** 2) * np.clip((C - 0.05) / 0.08, 0, 1)
        w_skin = np.exp(-((h_deg - 42) / 18) ** 2) * (C < 0.06) * (L > 0.3)
        w_cool = np.exp(-((h_deg - 238) / 35) ** 2) * (C < 0.06) * (L > 0.4)

        C_factor = np.ones_like(C)
        h_shift = np.zeros_like(h_deg)

        C_factor += 0.35 * w_red
        h_shift += 5.0 * w_red

        C_factor += 0.18 * w_skin
        h_shift += 4.0 * w_skin

        C_factor += 0.25 * w_cool

    C_out = C * C_factor
    h_out = np.radians((h_deg + h_shift) % 360)

    a_out = C_out * np.cos(h_out)
    b_out = C_out * np.sin(h_out)

    # Lab back to RGB
    l_ = L_out + 0.3963377774 * a_out + 0.2158037573 * b_out
    m_ = L_out - 0.1055613458 * a_out - 0.0638541728 * b_out
    s_ = L_out - 0.0894841775 * a_out - 1.2914855480 * b_out

    l_lin = np.maximum(l_, 0) ** 3
    m_lin = np.maximum(m_, 0) ** 3
    s_lin = np.maximum(s_, 0) ** 3

    r_res = +4.0767416621 * l_lin - 3.3077115913 * m_lin + 0.2309699292 * s_lin
    g_res = -1.2684380046 * l_lin + 2.6097574011 * m_lin - 0.3413193965 * s_lin
    b_res = -0.0041960863 * l_lin - 0.7034186147 * m_lin + 1.7076147010 * s_lin

    lin_res = np.stack([r_res, g_res, b_res], axis=-1)
    mask = lin_res > 0.0031308
    rgb_final = np.zeros_like(lin_res)
    rgb_final[mask] = 1.055 * (np.maximum(lin_res[mask], 0) ** (1.0 / 2.4)) - 0.055
    rgb_final[~mask] = 12.92 * np.maximum(lin_res[~mask], 0)
    return np.clip(rgb_final, 0, 1)


def save_cube(lut_table: np.ndarray, path: Path, title: str) -> None:
    n = lut_table.shape[0]
    with open(path, "w") as f:
        f.write(f'TITLE "{title}"\nLUT_3D_SIZE {n}\n')
        for v in lut_table.reshape(-1, 3):
            f.write("%.7f %.7f %.7f\n" % tuple(v))
    print(f"Saved {path.name}")


def main() -> None:
    LUT_DIR.mkdir(parents=True, exist_ok=True)

    match_lut = build_lut("match", LUT_SIZE)
    save_cube(match_lut, LUT_DIR / "Film Flash.cube", "Film Flash")

    uni_lut = build_lut("universal", LUT_SIZE)
    save_cube(uni_lut, LUT_DIR / "Film Flash Normal.cube", "Film Flash Normal")


if __name__ == "__main__":
    main()
