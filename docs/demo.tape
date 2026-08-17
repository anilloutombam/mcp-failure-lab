Output docs/demo.gif

Set Shell "zsh"
Set FontSize 18
Set Width 1100
Set Height 620
Set Padding 24
Set Theme { "name": "Catppuccin Mocha", "black": "#45475a", "red": "#f38ba8", "green": "#a6e3a1", "yellow": "#f9e2af", "blue": "#89b4fa", "magenta": "#f5c2e7", "cyan": "#94e2d5", "white": "#bac2de", "brightBlack": "#585b70", "brightRed": "#f38ba8", "brightGreen": "#a6e3a1", "brightYellow": "#f9e2af", "brightBlue": "#89b4fa", "brightMagenta": "#f5c2e7", "brightCyan": "#94e2d5", "brightWhite": "#a6adc8", "background": "#1e1e2e", "foreground": "#cdd6f4", "selectionBackground": "#353749", "cursorColor": "#f5e0dc" }
Set TypingSpeed 20ms
Set PlaybackSpeed 1

Type "npm run --silent start -- run examples/scenarios/delay-success.json"
Enter
Sleep 1.5s

Type "npm run --silent start -- run examples/scenarios/hang-timeout.json"
Enter
Sleep 2s
