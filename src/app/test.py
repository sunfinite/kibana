from contextlib import contextmanager

@contextmanager
def test():
    try:
        print 'set'
        yield True
    finally:
        print 'unset'

def a():
    with test():
        print 'here'

with test():
    print 'in'
    a()
    print 'out'
