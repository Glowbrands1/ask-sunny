for spec in "Ask-bubbles 559 98aa824e6e35097008dac8b0a9ecd55024b446be" "Ask-bubbles 558 9240fa0a1532f3861d6732878432fceee3672f5e" "Ask-bubbles 560 a0c4bce9188929dea8392e63eec710177a265d1a" "Ask-bubbles 563 4804483cb745c7e5cc6cc8e4e0ce9bb5f1160dee" "Ask-bubbles 565 fc590d8388b6f6ee423afbc142f0590f86080408" "Ask-bubbles 479 4f65096c1bc9717dba2b2569209bada75c7631eb" "Ask-bubbles 499 cada67e9b7bfefc2a28d436a3813c2f9b3b5b3b6" "Ask-bubbles 486 da27c64f41eb215eb7873bbf99b0fa7ceb98a79d" "ask-sunny 639 2c5756e19248699169de9f20a6da36f3f988e667" "ask-sunny 647 68acc8d6148870466843732c7c7ba5501d900296"; do
 set -- $spec
 echo "== $1#$2"
 gh api "repos/Glowbrands1/$1/commits/$3/check-runs" --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion)"' 2>&1 | sort | uniq -c | head -20
done
