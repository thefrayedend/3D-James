"""Stand-in for the tqdm progress-bar package, which pysmb imports but the box never uses (no progress bars)."""


class tqdm:
    def __init__(self, *a, **k):
        pass

    def update(self, *a):
        pass

    def close(self):
        pass
