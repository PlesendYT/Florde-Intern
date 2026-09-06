#!/usr/bin/env bash
set -e
# Installiert Custom-Tools aus den gemounteten Verzeichnissen (Sekundär-Initialisierung).
# /opt/custom-tools und /opt/global-tools enthalten bereits installierte Pakete
# (apt-Skripte, .deb, AppImages), die beim Container-Start bereitstehen.
#
# Wenn manuell Tools nachinstalliert werden sollen, geschieht das über apt im
# laufenden Container (jemane Zustimmung der KI/des Users).

for t in /opt/custom-tools/*.sh; do
  [ -e "$t" ] && bash "$t"
done
for t in /opt/global-tools/*.sh; do
  [ -e "$t" ] && bash "$t"
done

# Führe weiter (CMD) aus
exec "$@"
