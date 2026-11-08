BIN     := ydash
ENTRY   := src/cli.ts
BIN_DIR := $(HOME)/.local/bin

ARGS    ?=

.PHONY: help install build link ship uninstall clean run typecheck

.DEFAULT_GOAL := help

############################################################
# HELP #####################################################
############################################################
help:
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make \033[36m<target>\033[0m [ARGS=<flags>]\n\nTargets:\n"}'
	@grep -h -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@printf "\nVariables:\n"
	@printf "  \033[36m%-20s\033[0m %s\n" "ARGS" "extra flags, e.g. ARGS='release --no-open'"
	@printf "\nFull flag list: bun run $(ENTRY) --help\n"

############################################################
# BUILD ####################################################
############################################################
install: ## Install dev dependencies (types only)
	bun install

build: ## Compile a standalone binary
	bun build $(ENTRY) --compile --minify --outfile $(BIN)
	@# --compile leaves a .<hash>-00000000.bun-build behind every run.
	@rm -f .*.bun-build

link: ## Symlink the compiled binary onto the PATH
	mkdir -p $(BIN_DIR)
	ln -sf $(CURDIR)/$(BIN) $(BIN_DIR)/$(BIN)
	@echo "linked $(BIN_DIR)/$(BIN) -> $(CURDIR)/$(BIN)"

ship: build link ## Build then link (the usual "ship a new version" target)

uninstall: ## Remove the symlink from the PATH
	rm -f $(BIN_DIR)/$(BIN)

clean: ## Remove the compiled binary and build artifacts
	rm -f $(BIN) .*.bun-build

############################################################
# RUN ######################################################
############################################################
run: ## Run from source in this folder
	bun run $(ENTRY) $(ARGS)

############################################################
# CHECK ####################################################
############################################################
typecheck: ## Type-check without emitting
	bunx tsc --noEmit
