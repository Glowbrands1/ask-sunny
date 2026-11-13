#!/bin/bash
S=${GATE_OUT:-/tmp/gate-out}
cd $1; env -i HOME=$HOME PATH=$PATH npm test > $S/$2.log 2>&1; echo "exit $?" >> $S/$2.log
