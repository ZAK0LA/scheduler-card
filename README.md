# integration-meta

Przepis na gałąź `integration` w forkach ZAK0LA/scheduler-card i ZAK0LA/scheduler-component
(to ją instaluje HACS) oraz skrypt, który ją według niego składa.

- `card.manifest`, `component.manifest`: lista kroków, czytana od góry do dołu.
- `patches/card/`: małe poprawki, które istnieją tylko w forku (łączą dwie funkcje ze sobą).
- `integration.sh`: skrypt. Nigdy nic nie wypycha.

## Kiedy maintainer coś przyjmie albo odrzuci

```sh
./integration.sh card status       # co już jest w upstreamie, stan PR-ów, zapomniane gałęzie
# popraw card.manifest: przyjęte linie przenieś do "Accepted upstream"
./integration.sh card rebuild      # kopia zapasowa jako tag, reset do upstream/main, wszystkie kroki
./integration.sh card compare      # różnica względem kopii zapasowej, bez dist/
# test w HA, potem ręcznie: git push --force-with-lease origin integration
```

Konflikt, którego rerere nie zna: skrypt się zatrzymuje. Rozwiąż go, zrób `git add` (bez commita) i uruchom
`./integration.sh card continue`. Albo `./integration.sh card abort` wraca do kopii zapasowej.
Rerere zapamiętuje rozwiązanie, więc następna przebudowa przejdzie ten krok sama.

## Zasady

- Merge zawiera tylko rozwiązanie konfliktu. Zmiany, które dopasowują dwie funkcje do siebie, idą do `patches/`.
- Patche są eksportowane na nowo po każdym zastosowaniu, więc ich diff w tym repo pokazuje, co się zmieniło.
- Gałęzie funkcji opierają się na `upstream/main` (albo na gałęzi, od której zależą), nigdy na `integration`.
- Test bez ruszania `integration`: worktree z nową gałęzią od `upstream/main`, potem
  `rebuild --repo <worktree> --branch <gałąź> --version <N>` i `compare <ref>`.
