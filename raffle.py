#!/usr/bin/env python3
import random
import time
import sys
import os
import shutil

entries = {
    "FREE#195": 41, "CHUM#828": 29, "VMAN#920": 17, "XRXZ#614": 15,
    "SUICID#3": 13, "DAWN#777": 12, "SSL#398": 12, "SPAP#1": 12,
    "DUCK#291": 10, "MAJ#114": 10, "ZIM#0": 9, "HI#659": 9,
    "GRAMS#2": 9, "STIC#839": 9, "DEWG#944": 9, "BROD#343": 9,
    "MAR#10": 8, "MOLL#928": 7, "AUTM#525": 7, "SALZ#312": 7,
    "SMON#199": 6, "NEED#292": 6, "SALT#747": 6, "RATP#874": 6,
    "IDK#543": 6, "SSBM#351": 6, "ATHENA#0": 6, "SOON#122": 6,
    "DAWSON#0": 6, "HBOX#305": 6, "GIO#965": 6, "BLAR#513": 5,
    "ADO#542": 5, "PAST#981": 5, "BREN#657": 5, "BONES#0": 5,
    "CHAM#826": 5, "KATZ#433": 4, "RAUL#132": 4, "REV#443": 4,
    "MATW#444": 4, "APOLLO#6": 4, "GHOST#3": 4, "ALEX#154": 4,
    "RASH#342": 4, "SAVE#362": 3, "SORR#607": 3, "BUEN#652": 3,
    "SALT#348": 3, "JEZO#378": 3, "AFK#637": 3, "ZACH#739": 3,
    "BLOB#273": 3, "SAL#574": 3, "TREE#521": 3, "SFLD#692": 3,
    "DAFT#455": 3, "NDOC#204": 3, "ICE#574": 3, "ANT#0": 3,
    "ROB#610": 3, "SOUL#563": 3, "NOM#319": 3, "ZARO#666": 3,
    "BROOKE#0": 2, "TBGG#818": 2, "KINS#0": 2, "CEG#837": 2,
    "VINT#527": 2, "PIAN#258": 2, "JAX#124": 2, "UWU#444": 2,
    "SANC#210": 2, "KEYS#498": 2, "SUMP#892": 2, "SOSO#236": 2,
    "FROO#585": 2, "LEBR#818": 2, "PORC#252": 2, "UNDR#723": 2,
    "YURI#69": 2, "BOTY#571": 2, "STRW#531": 2, "VII#777": 2,
    "SHME#636": 2, "CAM#107": 2, "CHAR#257": 1, "SYNN#583": 1,
    "IBDW#0": 1, "KIYU#573": 1, "JADE#0": 1, "REN#609": 1,
    "ALOP#685": 1, "PORO#642": 1, "HODS#185": 1, "DODO#308": 1,
    "SSRB#611": 1, "OASI#364": 1, "PRAX#530": 1, "LEON#873": 1,
    "JAYDES#0": 1, "LOP#1312": 1, "ROSE#460": 1, "XANAX#42": 1,
    "TJ#0": 1, "NUTZ#820": 1, "GALPAL#9": 1, "EGGZ#827": 1,
    "ENVY#3": 1, "INK#871": 1, "FROG#338": 1, "BRTL#477": 1,
    "SAMUS#0": 1, "WALL#710": 1, "COCO#498": 1, "KWEE#704": 1,
    "LOAN#0": 1, "MORS#762": 1, "CPAPA#3": 1, "KUMA#214": 1,
    "SWAG#716": 1, "WOLF#341": 1, "KBZZ#875": 1, "WAAK#455": 1,
    "THONK#0": 1, "CHEK#318": 1, "KOTA#192": 1, "SPGT#255": 1,
    "GAY#420": 1, "CODA#754": 1, "TALL#650": 1,
}

# ── helpers ──────────────────────────────────────────────────────────

def cols():
    return shutil.get_terminal_size().columns

def clear():
    os.system("cls" if os.name == "nt" else "clear")

def center(text):
    return text.center(cols())

def typewrite(text, delay=0.02, centered=False):
    line = text.center(cols()) if centered else text
    for ch in line:
        sys.stdout.write(ch)
        sys.stdout.flush()
        time.sleep(delay)
    print()

def slow_print(text, delay=0.005, centered=False):
    line = text.center(cols()) if centered else text
    for ch in line:
        sys.stdout.write(ch)
        sys.stdout.flush()
        time.sleep(delay)
    print()

def flash_text(text, times=3, on=0.15, off=0.1):
    w = cols()
    for _ in range(times):
        print(f"\033[1m{text.center(w)}\033[0m", end="\r")
        sys.stdout.flush()
        time.sleep(on)
        print(" " * w, end="\r")
        sys.stdout.flush()
        time.sleep(off)
    print(f"\033[1m{text.center(w)}\033[0m")

def wait():
    input()

def bar_line(ch="═"):
    print(center(ch * min(60, cols() - 4)))

def blank(n=1):
    for _ in range(n):
        print()

LOGO = [
    "        ██                        ",
    "        ██                        ",
    "        ██                        ",
    "   ██   ██     ✿  ✿  ✿           ",
    "   ██   ██████████████████        ",
    "   ██                    ██       ",
    "   ██                    ██       ",
    "   ██                    ██       ",
    "   █████████████         ██       ",
    "    ✿  ✿  ✿   ██        ██       ",
    "              ██         ██       ",
    "              █████████████       ",
]

GLITCH_CHARS = "█▓▒░╬╠╣╗╔║═▄▀▐▌"

def logo_glitch_reveal(lines, passes=4, dt=0.06):
    """Flash random glitch frames, then reveal the real logo."""
    w = cols()
    h = len(lines)
    max_line_w = max(len(l) for l in lines)

    for p in range(passes):
        clear()
        blank(3)
        for _ in range(h):
            garbled = "".join(random.choice(GLITCH_CHARS) for _ in range(max_line_w))
            print(garbled.center(w))
        sys.stdout.flush()
        time.sleep(dt)

    clear()
    blank(3)
    for ln in lines:
        print(ln.center(w))
        sys.stdout.flush()
        time.sleep(0.02)
    time.sleep(0.15)

# ── pre-pick the winner ─────────────────────────────────────────────

total_points = sum(entries.values())
codes = list(entries.keys())
weights = list(entries.values())
winner = random.choices(codes, weights=weights, k=1)[0]

# build the "slot machine" reel — shuffled codes ending with the winner
reel = [c for c in codes if c != winner]
random.shuffle(reel)
reel = reel[:20] + [winner]

# ── SCENE 1: logo + title card ───────────────────────────────────────

logo_glitch_reveal(LOGO, passes=5, dt=0.05)

blank()
bar_line("━")
blank()
typewrite("F R I E N D L I E S", delay=0.007, centered=True)
blank()
typewrite("R  A  F  F  L  E", delay=0.009, centered=True)
blank()
bar_line("━")
blank(2)
slow_print(f"{len(entries)} entrants  ·  {total_points} total raffle points", centered=True)
blank(3)
slow_print("[ press ENTER to begin ]", delay=0.015, centered=True)
wait()

# ── SCENE 2: scrolling entrants ─────────────────────────────────────

blank(2)
bar_line()
typewrite("THE ENTRANTS", delay=0.025, centered=True)
bar_line()
blank()

sorted_entries = sorted(entries.items(), key=lambda x: -x[1])
col_w = 22
per_row = max(1, (cols() - 4) // col_w)

row = []
for code, pts in sorted_entries:
    cell = f"  {code:<12} {pts:>3} pts"
    row.append(cell)
    if len(row) == per_row:
        print("".join(row))
        time.sleep(0.02)
        row = []
if row:
    print("".join(row))

blank(2)
slow_print("[ press ENTER to spin ]", delay=0.015, centered=True)
wait()

# ── SCENE 3: slot-machine spin ──────────────────────────────────────

blank(4)
bar_line("━")
blank()
typewrite("S P I N N I N G . . .", delay=0.03, centered=True)
blank()
bar_line("━")
blank(3)

w = cols()
box_w = 30
pad = " " * ((w - box_w) // 2)
border = pad + "╔" + "═" * (box_w - 2) + "╗"
bottom = pad + "╚" + "═" * (box_w - 2) + "╝"

# total spin target: ~4 seconds
RAPID_COUNT = 30
RAPID_DT = 0.03          # 30 × 0.03 = 0.9s
SLOW_COUNT = 12
SLOW_BUDGET = 3.1         # remaining time for deceleration

# pre-compute deceleration delays that sum to SLOW_BUDGET
raw = [(i / (SLOW_COUNT - 1)) ** 2 for i in range(SLOW_COUNT)]
scale = SLOW_BUDGET / sum(raw)
slow_delays = [r * scale for r in raw]

reel_short = reel[: SLOW_COUNT - 1] + [reel[-1]]

# rapid spin phase
for _ in range(RAPID_COUNT):
    name = random.choice(codes)
    line = f"║  {name:^{box_w - 4}}  ║"
    print(border)
    print(pad + line)
    print(bottom)
    sys.stdout.flush()
    time.sleep(RAPID_DT)
    sys.stdout.write("\033[3A")

# slow-down phase
for i, name in enumerate(reel_short):
    line = f"║  {name:^{box_w - 4}}  ║"
    print(border)
    print(pad + line)
    print(bottom)
    sys.stdout.flush()
    time.sleep(slow_delays[i])
    if i < len(reel_short) - 1:
        sys.stdout.write("\033[3A")

# ── immediate reveal after spin stops ──────────────────────────────

blank(2)
time.sleep(0.3)

pct = entries[winner] / total_points * 100
big_name = f"★  {winner}  ★"

flash_text(big_name, times=5, on=0.2, off=0.15)
blank()
bar_line("━")
blank()

typewrite(f"{entries[winner]} points  ·  {pct:.1f}% chance", delay=0.02, centered=True)
blank(2)

# confetti burst
confetti_chars = "★ ✦ ✧ ◆ ● ♦ ✶ ✴ ✹"
for _ in range(6):
    row_out = ""
    for _ in range(w // 2):
        if random.random() < 0.3:
            row_out += random.choice(confetti_chars.split()) + " "
        else:
            row_out += "  "
    print(row_out[:w])
    time.sleep(0.08)

blank()
print(center("🏆  C O N G R A T S  🏆"))
blank(2)
