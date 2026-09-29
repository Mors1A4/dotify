import os
from PIL import Image, ImageDraw, ImageColor

RES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res'))

COLORS = {
    'green': '#1ED760',
    'cyan': '#00F0FF',
    'purple': '#A855F7',
    'pink': '#FF2A85',
    'orange': '#FF6B35',
    'amber': '#FBBF24',
    'red': '#EF4444',
    'blue': '#38BDF8'
}

DENSITIES = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

BG_COLOR = '#121212'

def generate_vector_foreground(color_hex):
    return f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="{color_hex}"
        android:fillType="evenOdd"
        android:pathData="M54,22 a32,32 0 1,0 0,64 a32,32 0 1,0 0,-64 Z M54,42 a12,12 0 1,0 0,24 a12,12 0 1,0 0,-24 Z" />
</vector>
'''

def generate_vector_background():
    return f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="{BG_COLOR}"
        android:pathData="M0,0h108v108h-108z" />
</vector>
'''

def generate_adaptive_icon(color_name):
    fg_name = f'ic_launcher_foreground_{color_name}' if color_name != 'default' else 'ic_launcher_foreground_green'
    return f'''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/{fg_name}" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
'''

def render_png_icon(size, color_hex, is_round=False):
    # Supersample at 4x for crystal clear anti-aliasing
    scale = 4
    canvas_size = size * scale
    im = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)

    bg_rgb = ImageColor.getrgb(BG_COLOR)
    accent_rgb = ImageColor.getrgb(color_hex)

    center = canvas_size / 2.0
    
    if is_round:
        # Full circular icon
        r_bg = (canvas_size - scale * 2) / 2.0
        draw.ellipse([center - r_bg, center - r_bg, center + r_bg, center + r_bg], fill=(*bg_rgb, 255))
    else:
        # Rounded squircle for legacy square launchers
        corner_r = canvas_size * 0.22
        draw.rounded_rectangle([scale, scale, canvas_size - scale, canvas_size - scale], radius=corner_r, fill=(*bg_rgb, 255))

    # Dotify Logo: Outer Accent Circle (radius ~ 34% of canvas size)
    r_outer = canvas_size * 0.33
    draw.ellipse([center - r_outer, center - r_outer, center + r_outer, center + r_outer], fill=(*accent_rgb, 255))

    # Dotify Logo: Inner Dark Cutout Dot (radius ~ 12% of canvas size)
    r_inner = canvas_size * 0.125
    draw.ellipse([center - r_inner, center - r_inner, center + r_inner, center + r_inner], fill=(*bg_rgb, 255))

    # Downsample with Lanczos
    return im.resize((size, size), Image.Resampling.LANCZOS)

def main():
    print(f"Android res dir: {RES_DIR}")
    drawable_dir = os.path.join(RES_DIR, 'drawable')
    os.makedirs(drawable_dir, exist_ok=True)
    anydpi_dir = os.path.join(RES_DIR, 'mipmap-anydpi-v26')
    os.makedirs(anydpi_dir, exist_ok=True)
    values_dir = os.path.join(RES_DIR, 'values')
    os.makedirs(values_dir, exist_ok=True)

    # 1. Background vector
    bg_path = os.path.join(drawable_dir, 'ic_launcher_background.xml')
    with open(bg_path, 'w', encoding='utf-8') as f:
        f.write(generate_vector_background())
    print(f"Written: {bg_path}")

    # 2. Values background color
    val_bg_path = os.path.join(values_dir, 'ic_launcher_background.xml')
    with open(val_bg_path, 'w', encoding='utf-8') as f:
        f.write(f'''<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">{BG_COLOR}</color>
</resources>
''')
    print(f"Written: {val_bg_path}")

    # 3. Monochrome vector (for Android 13+ Material You themed icons)
    mono_path = os.path.join(drawable_dir, 'ic_launcher_monochrome.xml')
    with open(mono_path, 'w', encoding='utf-8') as f:
        f.write(generate_vector_foreground('#FFFFFF'))
    print(f"Written: {mono_path}")

    # 4. Color foreground vectors and adaptive icons
    for name, hex_code in COLORS.items():
        fg_path = os.path.join(drawable_dir, f'ic_launcher_foreground_{name}.xml')
        with open(fg_path, 'w', encoding='utf-8') as f:
            f.write(generate_vector_foreground(hex_code))
        
        adaptive_path = os.path.join(anydpi_dir, f'ic_launcher_{name}.xml')
        with open(adaptive_path, 'w', encoding='utf-8') as f:
            f.write(generate_adaptive_icon(name))
    
    # Default adaptive icon (Green)
    with open(os.path.join(anydpi_dir, 'ic_launcher.xml'), 'w', encoding='utf-8') as f:
        f.write(generate_adaptive_icon('default'))
    print("Adaptive icons generated.")

    # 5. PNG mipmaps for all densities
    for folder, size in DENSITIES.items():
        density_dir = os.path.join(RES_DIR, folder)
        os.makedirs(density_dir, exist_ok=True)

        for name, hex_code in COLORS.items():
            img_square = render_png_icon(size, hex_code, is_round=False)
            img_round = render_png_icon(size, hex_code, is_round=True)

            img_square.save(os.path.join(density_dir, f'ic_launcher_{name}.png'), format='PNG')
            img_round.save(os.path.join(density_dir, f'ic_launcher_{name}_round.png'), format='PNG')

            # Default green copies
            if name == 'green':
                img_square.save(os.path.join(density_dir, 'ic_launcher.png'), format='PNG')
                img_round.save(os.path.join(density_dir, 'ic_launcher_round.png'), format='PNG')

        print(f"Rendered PNGs for {folder} ({size}x{size})")

    print("\nSUCCESS: All Android themed icons and vectors generated!")

if __name__ == '__main__':
    main()
