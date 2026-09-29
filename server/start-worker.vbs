Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\monty\Documents\AB\notify"
WshShell.Run "node server\index.js", 0, False
