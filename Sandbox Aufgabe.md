IMPORTANT: Diese Idee ist nicht für den anfang und dauert viel zeit und ist sehr Komplex.

1\. Den Sandbox zu einer richtigen isolierten Arbeitsumgebung für die KI machen

2\. Florde Sandbox-Manager

Beim ersten Einrichten soll gefragt werden: Wie soll die KI arbeiten dürfen im Sandbox-Mode?

\- Sandbox (Container Sandbox, Firejail, Docker, Podman, Virtual Machine (VMware))

Da steht dann Vor- und Nachteile. z.b:

\- Kleiner Sandbox: Beschreibung: Schnelle, isolierte Umgebung für normale Aufgaben. Vorteile: Sehr schnell, weniger RAM/CPU-Verbrauch, gut für Code-Analysen, Tests und kleine Änderungen. Nachteile: Weniger Isolation, bei schweren Fehlern weniger Schutz.

\- Firejail Sandbox:  
Beschreibung: Die KI arbeitet in einer leichtgewichtigen Linux-Sandbox. Anwendungen werden mit eingeschränkten Rechten gestartet und können je nach Konfiguration nur auf bestimmte Dateien, Geräte oder Netzwerkfunktionen zugreifen.
Vorteile: Sehr schnell, geringer RAM-/CPU-Verbrauch, deutlich bessere Isolation als eine normale Programmausführung, ideal für Code-Ausführung, Tests und Entwicklungsaufgaben unter Linux. Nachteile: Nur unter Linux verfügbar, keine vollständige virtuelle Maschine, Programme teilen sich weiterhin den Linux-Kernel, ungeeignet für Vision-Modelle oder Anwendungen, die einen eigenen Desktop benötigen.

\- Docker/Podman Sandbox: Beschreibung: Die KI arbeitet in einem Container. Vorteile: Gute Isolation, reproduzierbare Umgebung, unterschiedliche Entwicklungsumgebung möglich. Docker muss installiert sein, etwas mehr Ressourcen braucht, nicht gleiche Sicherheit wie echte VM.

\- VM Sandbox: Eine komplette virtuelle Maschine für die KI. Vorteile: Höchste Isolation, eigene Umgebung, riskante Tests möglich. Chart: Software bleibt eher eingeschlossen. Modelle mit Vision können das Sehen und auch steuern wie ein eigener PC.

Florde soll auch eine Empfehlung geben, je nach Setup, also RAM, CPU und GPU, und dann das, was empfohlen ist, als empfohlen anzeigen und dass es auf die Komponente des PCs spezifiziert wurde, diese Empfehlung. Wenn die KI Vision unterstützt, dann soll die nicht nach Screenshot fragen, sondern nach Sehen fragen. Das jetzt nicht pro jedes Mal, wenn wer was sehen möchte, sondern pro Aufgabe. Sobald eine Antwort im Text von der KI kommt und dieses „Stop“ weggeht, wo sonst „Senden“ steht, dann soll das als Vision beendet zählen. Wenn die VMWare gestartet ist und die KI da was macht, soll der User auch sehen können in einem Fenster, was die KI macht. Also wirklich genau den Bildschirm wie bei Manus. Außerdem soll es Knöpfe geben, wie KI anhalten, also Pause, dann Stop, um eine Aufgabe abzubrechen, oder übernehmen, um die Kontrolle über diesen VMWare PC zu übernehmen und wirklich mit der Maus in diesem Fenster zu interagieren. Es soll aber natürlich auch im Audit Log gezeigt werden, dass diese KI was gemacht hat und was sie gemacht hat. Zwar nicht alles einzeln, aber Sachen wie:

Vision Session gestartet

Aufgabe UI Test

Vision Erlaubnis nur für diese Aufgabe

Sandbox z.b jetzt Florde VM03 Aktionen

Und dann werden die Aktionen gezeigt.

Die KI soll auch eigenständig Snapshots machen mit dem VMware Snapshot Feature vor riskanten Änderungen.

bei VMWare soll man auch wählen können welches Os ob: linux, windows (light), anderes. und bei Vision modell ob UI oder Headless ohne vision modell nur Headless

Nicht nur

> Empfohlen

sondern

```
Empfohlen für deinen PC

CPU
✓ Ryzen 7 7800X

RAM
✓ 32 GB

GPU
✓ RTX 3060

Empfehlung:

Docker Sandbox
```

Oder

```
RAM: 8 GB

→ Kleine Sandbox empfohlen
```

# Betriebssystem-Auswahl

Ich würde Templates anbieten.

```
Windows 11 Light

Windows 10

Ubuntu

Linux Mint

Arch

Debian

Fedora

Benutzerdefiniert
```

Dann kann Florde das Image selbst herunterladen oder verwenden.
Benutzerdefiniert ist eigedes image/iso oder so.

# Netzwerk

```
Internet

○ Kein Internet

○ Nur localhost

○ Nur Projektserver

○ Alles

○ Benutzerdefiniert
```
