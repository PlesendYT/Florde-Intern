# Ollama Agent Loop — Tool-Use Enforcement

## Problem
Ollama-Modelle (getestet: deepseek-coder-v2, qwen2.5-coder, codellama, mistral, etc.) vergessen nach dem ersten Tool-Call (`list_files`) dass sie Tools haben. Statt `write_file`/`edit_file` zu verwenden, geben sie Code als Chat-Text aus. Der System-Prompt mit Tool-Definitionen wird vom Model ignoriert, sobald die Konversation länger wird.

## Solution: Tool-Reminder Agent Loop

### Flow
Jeder Durchlauf im Kreis, bis das Model Text statt Tool-Call liefert:

```
1. REMINDER an Model senden (vor jedem Request im Loop):
   "Du hast diese Tools: [aktive Tool-Liste].
    - Wenn du ein Tool brauchst: antworte NUR mit dem Tool-Call (KEIN Text)
    - Wenn du fertig bist: antworte NUR mit Text (KEIN Tool-Call)
    - Du darfst mehrere Tools nacheinander benutzen, aber immer nur EINS pro Antwort"

2. Model → tool_call (z.B. list_files, read_file, write_file)

3. Tool ausführen, Ergebnis an Model zurückgeben

4. Wiederholung von Schritt 1 (REMINDER)

5. Sobald Model → Text (kein Tool-Call) → FERTIG, Antwort an User
```

### Key Changes

1. **Tool-Reminder statt System-Prompt**: Die Tool-Liste + Verhaltensanweisung wird als kompakte Text-Nachricht DIREKT VOR jedem Model-Request eingefügt (nicht nur im System-Prompt am Anfang). Kürzerer, prägnanter Text.

2. **Single-Tool-Call pro Response**: Model darf nur EINEN Tool-Call pro Antwort machen (statt bis zu 5). Reduziert Verwirrung bei kleineren Modellen.

3. **Tool-Call History persistieren**: Tool-Call-Paare (assistant + tool-result) werden in `chatHistory` gespeichert, nicht nur die finale Antwort. So weiss das Model beim nächsten User-Input, was passiert ist.

4. **Loop-Erkennung**: Wenn das Model 3+ Mal das gleiche Tool mit gleichen Argumenten aufruft → abbrechen und User informieren (bestehende Loop-Erkennung verbessern).

5. **Enforcement**: Antwort auf Text-Code-Prüfung:
   - Enthält Antwort Code-Blöcke (```) aber keinen Tool-Call → "Bitte benutze write_file/edit_file statt Code zu posten" zurückspielen
   - Enthält Antwort Tool-Call + Text → "Bitte sende NUR den Tool-Call oder NUR Text, nicht beides"

### Implementation

**Dateien:**
- `App/renderer/script.js` — sendMessage-Funktion anpassen, REMINDER-String bauen, Loop-Logik ändern
- `App/renderer/tools/command-registry.js` — optional, wenn neue Commands für den Agent Loop nötig

**Änderungen in sendMessage() (ca. Zeile 4090-4340):**

```
function buildToolReminder(hasTools):
  if hasTools:
    return "Du hast diese Tools:\n- read_file: ...\n- write_file: ...\n...
    Regel: ONLY Tool-Call ODER Text. Nie beides."

function sendMessage(...):
  # Vor dem ersten Request im Loop:
  reminder = buildToolReminder(supportsTools)
  messages = [reminder, ...conversationMessages]
  
  while toolRounds < maxRounds:
    response = await prov.sendWithTools(messages, tools)
    
    if response.tool_calls und response.tool_calls.length > 0:
      # Tool ausführen (nur das erste)
      toolCall = response.tool_calls[0]
      result = await executeToolCall(toolCall)
      
      # Tool-Call-Paar in chatHistory speichern
      chatHistory.push({ role: 'assistant', content: null, tool_calls: [toolCall] })
      chatHistory.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
      
      # REMINDER für nächsten Durchlauf
      messages = [reminder, ...conversationMessages, ...toolCallHistory]
      
    elif response.content:
      # Text-Antwort = fertig
      finalContent = response.content
      break
      
    elif enthältCodeBlöcke(response.content):
      # Enforcement: Code ohne Tool-Call abfangen
      messages.push({ role: 'user', content: 'Bitte benutze write_file statt Code zu posten.' })
      
    toolRounds++
```

### Testing
- `list_files` → erwarte tool_call Antwort (kein Text)
- `read_file` → erwarte tool_call Antwort (kein Text)
- `write_file` → erwarte tool_call Antwort (kein Text)
- Fertig → erwarte reine Text-Antwort (kein tool_call)
- Nach User-Rückfrage → Model sollte Tool-Call-History sehen und weiterarbeiten
