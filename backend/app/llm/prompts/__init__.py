"""Prompts, one module per job.

Two different calls to the same model, doing two unrelated things:

  reply.py       answer a customer, grounded in retrieved documentation
  extraction.py  classify a turn into an actionable request, or nothing

They are kept apart deliberately. Merging them would mean one prompt trying to
be helpful and analytical at once, and every future edit to one would risk
changing the behaviour of the other.
"""
