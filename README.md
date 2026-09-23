# **Florde**  
## **Allgemeine Informationen**  
**Name:** Florde  
  **Autor:** Plesend  
  **Autor-Kontakt:** Plesend@proton.me  
  **Projekt-Kontakt:** Florde@outlook.de  
  **Status:** Beta  
  **Discord:** discord.gg/Z2nREpXN4t   
## **Grundprinzip**  
Florde ist eine **Privacy-First-AI-Agent-Umgebung** für Softwareentwicklung und die Arbeit mit KI-Agenten.  
 Ein zentraler Grundsatz von Florde ist:  
 **Sicherheit und Kontrolle des Users stehen an erster Stelle. Bequemlichkeit geht niemals auf Kosten von Transparenz.  
 **Der User soll nachvollziehen und kontrollieren können, welche Aktionen eine KI ausführt und welche Berechtigungen sie dafür besitzt.  
 Florde ist deshalb nicht darauf ausgelegt, dass eine KI möglichst viele Aktionen automatisch und ohne Rückfrage ausführt. Stattdessen gibt es Kontroll- und Berechtigungssysteme, die den User in den Entscheidungsprozess einbeziehen.   
## **Entwicklungsumgebung**  
Florde beinhaltet eine integrierte Entwicklungsumgebung.  
 Dazu gehören unter anderem:   
- Monaco Editor   
- Datei-Explorer   
- mehrere Editor-Tabs   
- Terminal   
- Git-Integration   
- Projektverwaltung   
- KI-Chat   
- KI-Agenten   
- Diff-Ansichten   
- Code- und Projektwerkzeuge  
 Die IDE basiert auf **Monaco**.  
## **KI-Agenten**  
Florde ist auf die Verwendung von KI-Agenten ausgelegt.  
 Agenten können abhängig von ihren Berechtigungen Werkzeuge verwenden und Aufgaben innerhalb eines Projekts ausführen.  
 Dazu gehören beispielsweise Dateioperationen, Terminalaktionen und weitere integrierte Werkzeuge.  
 Florde besitzt ein **Permission Gate**, das Berechtigungen für entsprechende Aktionen kontrolliert.  
 KI-generierte Änderungen sollen für den User nachvollziehbar bleiben und nicht einfach als undurchsichtige Änderungen am Projekt erscheinen.   
## **Lokale KI**  
Florde unterstützt lokale KI-Modelle.  
 Eine wichtige Integration ist **Ollama**.  
 Über die Ollama-Integration können lokale Modelle in Florde verwendet werden. Florde unterstützt dabei auch **Tool Calling**, sodass ein lokales Modell mit den verfügbaren Werkzeugen der Umgebung arbeiten kann.  
 Dadurch ist Florde nicht ausschließlich auf externe KI-Provider angewiesen.   
## **MCP**  
Florde besitzt einen eigenen **MCP-Client**.  
 Unterstützte Verbindungsarten bzw. Transportmöglichkeiten umfassen:   
- stdio   
- SSE   
- WebSocket   
- MCP   
- Custom  
 MCP-Server können dadurch in die Florde-Umgebung eingebunden und von KI-Agenten verwendet werden.  
## **Isolierte Ausführung**  
Florde verfügt über mehrere Möglichkeiten, Code und Prozesse isoliert auszuführen.  
 Unterstützte bzw. integrierte Isolationen umfassen:   
- Docker   
- Firejail   
- Podman   
- VMware   
- QEMU   
- None  
   
 none bedeutet, dass kein isoliertes Backend verwendet wird.  
 Welche Umgebung verwendet wird, hängt von der jeweiligen Aufgabe und Konfiguration ab.   
## **VMware**  
Florde kann VMware als isolierte Umgebung verwenden.  
 In einer VMware-Umgebung können auch **Vision-Modelle** eingesetzt werden.  
 Diese können den virtuellen Desktop visuell erfassen und – abhängig von den verfügbaren Berechtigungen und Funktionen – mit der virtuellen Umgebung interagieren.  
 Dadurch können auch Aufgaben automatisiert werden, bei denen eine reine Datei- oder Terminalsteuerung nicht ausreicht.   
## **Permission Gate**  
Das Permission Gate ist ein wichtiger Bestandteil der Sicherheitsarchitektur von Florde.  
 Aktionen eines KI-Agenten werden nicht grundsätzlich als uneingeschränkt erlaubt betrachtet.  
 Je nach Aktion können entsprechende Berechtigungen erforderlich sein oder eine Zustimmung des Users notwendig werden.  
 Das Ziel ist, dass der User Kontrolle darüber behält, welche Fähigkeiten ein Agent innerhalb seiner Umgebung verwenden darf.   
## **Transparenz**  
Florde soll nicht nur ermöglichen, dass KI Aufgaben erledigt, sondern auch nachvollziehbar machen, **was die KI tatsächlich tut**.  
 Dazu gehören unter anderem:   
- nachvollziehbare Änderungen   
- Diff-Ansichten   
- Berechtigungskontrolle   
- Audit-Informationen   
- sichtbare Agent-Aktionen  
 Die genaue Darstellung und der Umfang der Kontrolle hängen von der jeweiligen Funktion und dem aktuellen Implementierungsstand ab.  
## **Datenschutz**  
Florde verfolgt einen **Privacy-First-Ansatz**.  
 Ein besonderer Schwerpunkt liegt darauf, dem User möglichst viel Kontrolle darüber zu geben, welche Daten lokal verarbeitet werden und welche externen Dienste verwendet werden.  
 Durch die Unterstützung lokaler Modelle, unter anderem über Ollama, kann KI-Verarbeitung auch lokal erfolgen.  
 Florde soll dabei nicht voraussetzen, dass sämtliche Entwicklungsdaten grundsätzlich an einen zentralen Cloud-Dienst übertragen werden.   
### **Secrets- und Capture-Schutz**  
 Alle Eingabefelder für Secrets (API-Keys, Tokens) tragen das Tag `data-secret="true"` und werden erzwungen maskiert (`type="password"`, keine Autovervollständigung/Rechtschreibprüfung) dargestellt.  
 Zusätzlich aktiviert Florde standardmäßig und ohne Toggle den nativen OS-Capture-Schutz des Hauptfensters (`BrowserWindow.setContentProtection`, kein DRM).  
 Geltung: **Windows** (ab Win 10 2004 vollständig aus Captures entfernt, älter: schwarzes Fenster), **macOS** (Ausnahme: neuere Apps mit Apples ScreenCaptureKit erfassen das Fenster trotz Schutz), **Linux: wirkungslos** (von Electron/Chromium nicht implementiert — unter Linux gibt es bewusst keine Capture-Garantie).  
## **Projektcharakter**  
Florde verbindet mehrere Bereiche in einer Anwendung:   
- KI-Agenten   
- Softwareentwicklung   
- IDE   
- lokale und externe KI-Modelle   
- Tool Calling   
- MCP   
- Terminal   
- Git   
- Sandbox- und Isolationssysteme   
- Sicherheits- und Berechtigungssysteme  
 Florde ist damit als integrierte Umgebung gedacht, in der KI nicht nur für Chat verwendet wird, sondern direkt in den Entwicklungsprozess eingebunden werden kann.  
    
# **Florde unterstützt verschiedene KI-Provider, darunter:**  
    
- OpenAI   
- DeepSeek   
- Mistral   
- Anthropic   
- Gemini   
- Grok   
- OpenRouter   
- OpenCode Zen   
- OpenCode Go   
- Custom   
- Ollama   
- LM Studio   
LocalAI  
