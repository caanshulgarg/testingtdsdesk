"""python3 run_e2e_payroll_real.py - run_e2e_payroll.py on what bridge 2.4.4 sent from real TallyPrime 7.1 (the payroll test
company's 36 entries as the bridge stripped and sent them: tally-versions mode payg, run 38271385254;
fixtures/payroll-e2e/real-7.1/bodies.xml) instead of the made-up Day Book: every figure to the paisa again. It runs
pg_stand (through run_e2e_payroll.py) on its own port, 30746, so CI runs it as it runs the other pg_stand tests."""
import os, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
env = dict(os.environ, PGE2EPAY_PORT=os.environ.get("PGE2EPAY_PORT") or "30746", REAL=os.path.join(HERE, "fixtures", "payroll-e2e", "real-7.1"))
sys.exit(subprocess.run([sys.executable, os.path.join(HERE, "run_e2e_payroll.py")], env=env).returncode)
