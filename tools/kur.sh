#!/usr/bin/env sh
# feyzullah-agents kurulum denetimi (macOS/Linux).
# Varsayılan: yalnız denetler, hiçbir şey kurmaz. --link: `fa` komutunu npm link ile ekler. --test: npm test.
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
fail=0
has() { command -v "$1" >/dev/null 2>&1; }
check() { if [ "$2" = 1 ]; then printf '  tamam  %-12s %s\n' "$1" "$3"; else printf '  EKSİK  %-12s %s\n' "$1" "$3"; fail=$((fail + 1)); fi; }

echo 'Gerekenler:'
if has node; then v=$(node -v); major=$(echo "$v" | sed 's/^v//; s/\..*//'); [ "$major" -ge 24 ] && ok=1 || ok=0; check node $ok "$v (24+ gerekli)"; else check node 0 'yok: https://nodejs.org'; fi
if has git; then check git 1 "$(git --version)"; else check git 0 yok; fi

echo 'Motorlar (en az biri):'
engines=0
for e in codex claude agy; do if has $e; then engines=$((engines + 1)); printf '  var    %s\n' $e; else printf '  yok    %s\n' $e; fi; done
[ $engines -gt 0 ] || { echo '  EKSİK  hiçbir motor bulunamadı'; fail=$((fail + 1)); }

echo 'Roblox paketi için (isteğe bağlı):'
for b in rokit rojo stylua selene lune luau-analyze; do if has $b; then printf '  var    %s\n' $b; else printf '  yok    %s\n' $b; fi; done

echo 'Ayarlar:'
printf '  FA_PORT          %s\n' "${FA_PORT:-4317 (varsayılan)}"

[ $fail -eq 0 ] || { echo "$fail eksik var."; exit 1; }
for a in "$@"; do
  case $a in
    --test) (cd "$root" && npm test) || exit 1 ;;
    --link) (cd "$root" && npm link) && echo 'fa komutu eklendi.' ;;
  esac
done
echo 'Hazır.'
