import argparse
import tkinter as tk


def size(value: str) -> tuple[int, int]:
    parts = value.lower().split("x", maxsplit=1)
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("erwartet WxH, zum Beispiel 1200x900")
    try:
        width, height = (int(part) for part in parts)
    except ValueError as error:
        raise argparse.ArgumentTypeError("Breite und Höhe müssen ganze Zahlen sein") from error
    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("Breite und Höhe müssen größer als null sein")
    return width, height


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fenster mit festen Größenhinweisen für KWin-Tests")
    parser.add_argument("--min", dest="minimum", type=size, metavar="WxH")
    parser.add_argument("--max", dest="maximum", type=size, metavar="WxH")
    parser.add_argument("--grid", type=size, metavar="WxH")
    parser.add_argument("--title", default="kxl-size-window")
    return parser.parse_args()


def main() -> None:
    args = arguments()
    if args.minimum and args.maximum:
        if args.minimum[0] > args.maximum[0] or args.minimum[1] > args.maximum[1]:
            raise SystemExit("--min darf in keiner Achse größer als --max sein")

    root = tk.Tk()
    root.title(args.title)
    root.geometry("640x480")
    if args.minimum:
        root.minsize(*args.minimum)
    if args.maximum:
        root.maxsize(*args.maximum)
    if args.grid:
        root.wm_grid(0, 0, *args.grid)

    tk.Label(root, text=args.title, padx=24, pady=24).pack(expand=True)
    root.mainloop()


if __name__ == "__main__":
    main()
